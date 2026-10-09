import { config } from '../config';
import type { CallRow } from '../types';

const API = 'https://api.hubapi.com';
const headers = () => ({ Authorization: `Bearer ${config.hubspot.token}`, 'content-type': 'application/json' });

async function hs(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, { ...init, headers: headers() });
  if (!res.ok) throw new Error(`HubSpot ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

/** Contact + deal for a qualified call. Idempotent on the contact (found by phone). */
export async function createLead(call: CallRow): Promise<NonNullable<CallRow['hubspot']>> {
  if (!config.hubspot.token) {
    return { contact_id: `mock-contact-${call.id}`, deal_id: `mock-deal-${call.id}`, mock: true };
  }
  const f = call.fields ?? {};
  const phone = call.caller_number;
  const [first, ...rest] = (f.name || 'Unknown caller').split(' ');

  let contactId: string | undefined;
  if (phone) {
    const found = await hs('/crm/v3/objects/contacts/search', {
      method: 'POST',
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'phone', operator: 'EQ', value: phone }] }], limit: 1 }),
    });
    contactId = found?.results?.[0]?.id;
  }
  if (!contactId) {
    const created = await hs('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({
        properties: { firstname: first, lastname: rest.join(' '), ...(phone ? { phone } : {}), city: f.locality ?? '' },
      }),
    });
    contactId = created.id;
  }

  const desc = [
    call.summary,
    f.scope && `Scope: ${f.scope}`,
    f.area_sqft && `Area: ${f.area_sqft} sq ft`,
    f.completion_date && `Timeline: ${f.completion_date}`,
    call.flags.length && `Flags: ${call.flags.join('; ')}`,
    call.booking && `Consultation booked: ${call.booking.start}`,
    `Call log: ${config.appUrl}/calls/${call.id}`,
  ]
    .filter(Boolean)
    .join('\n');

  const deal = await hs('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        dealname: `${f.name || 'Phone enquiry'} - ${f.locality || 'Pune'} ${f.project_type || ''}`.trim(),
        pipeline: config.hubspot.pipeline,
        dealstage: config.hubspot.dealStage,
        description: desc,
      },
    }),
  });
  await hs(`/crm/v4/objects/deals/${deal.id}/associations/default/contacts/${contactId}`, { method: 'PUT' });
  return { contact_id: contactId, deal_id: deal.id, mock: false };
}
