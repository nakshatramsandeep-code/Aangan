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
  // Browser test calls carry a label like "web-user" instead of a number; do not store that as a phone.
  const phone = /^\+?[\d\s()-]{8,}$/.test(call.caller_number ?? '') ? call.caller_number : undefined;
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
        properties: { firstname: first, lastname: rest.join(' '), ...(phone ? { phone } : {}), ...(f.email ? { email: f.email } : {}), city: f.locality ?? '' },
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
    call.consultation?.start && `Consultation call (tentative): ${new Date(call.consultation.start).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' })} IST`,
    f.email && `Email: ${f.email}`,
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

/**
 * Logs the tentative consultation as a meeting on the deal and contact, so HubSpot's timeline shows it.
 * (Creating a meeting through the API records it in HubSpot; the Google Calendar event is made separately.)
 */
export async function logMeeting(call: CallRow): Promise<string> {
  const c = call.consultation;
  if (!c?.start || !c.end) throw new Error('No consultation time to log');
  if (!config.hubspot.token || call.hubspot?.mock) return `mock-meeting-${call.id}`;
  const f = call.fields ?? {};
  const m = await hs('/crm/v3/objects/meetings', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        hs_timestamp: c.start,
        hs_meeting_title: `Consultation call (tentative) · ${f.name ?? 'New lead'}`,
        hs_meeting_body: `Tentative hold${c.link ? `: ${c.link}` : ''}\nCall log: ${config.appUrl}/calls/${call.id}`,
        hs_meeting_start_time: c.start,
        hs_meeting_end_time: c.end,
        hs_meeting_outcome: 'SCHEDULED',
      },
    }),
  });
  const deal = call.hubspot?.deal_id, contact = call.hubspot?.contact_id;
  if (deal) await hs(`/crm/v4/objects/meetings/${m.id}/associations/default/deals/${deal}`, { method: 'PUT' });
  if (contact) await hs(`/crm/v4/objects/meetings/${m.id}/associations/default/contacts/${contact}`, { method: 'PUT' });
  return String(m.id);
}
