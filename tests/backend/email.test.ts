/** The Twilio email transport (comms.twilio.com) and provider selection. */
import { emailProvider, parseSender, sendEmail } from '../../netlify/functions/_lib/email';
import { testEnv } from './helpers/harness';
import { installFetch, jsonResponse } from './helpers/fetchMock';

const MSG = { to: 'ana@x.test', subject: 'Your code', html: '<p>123456</p>', text: '123456' };

beforeEach(() => testEnv());

describe('email provider', () => {
  it('prefers Twilio, then Resend, else none', () => {
    expect(emailProvider()).toBeNull();
    process.env.RESEND_API_KEY = 're_x';
    expect(emailProvider()).toBe('resend');
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    expect(emailProvider()).toBe('resend');
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    expect(emailProvider()).toBe('twilio');
  });

  it('parses "Name <address>" senders', () => {
    expect(parseSender('PMO Capacity Planner <noreply@x.test>')).toEqual({
      name: 'PMO Capacity Planner',
      address: 'noreply@x.test',
    });
    expect(parseSender('noreply@x.test')).toEqual({ address: 'noreply@x.test' });
  });

  it('sends through Twilio with the API key and reports a rejected send as not sent', async () => {
    testEnv({ TWILIO_API_KEY: 'SK_test', TWILIO_API_SECRET: 'shh', FROM_EMAIL: 'PMO <noreply@x.test>' });
    const fetchMock = installFetch();
    fetchMock.mockImplementation(async () => jsonResponse({ operationId: 'comms_operation_1' }, 202));
    expect(await sendEmail(MSG)).toEqual({ sent: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://comms.twilio.com/v1/Emails');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('SK_test:shh').toString('base64')}`);
    expect(JSON.parse(init.body)).toEqual({
      from: { name: 'PMO', address: 'noreply@x.test' },
      to: [{ address: 'ana@x.test' }],
      content: { subject: 'Your code', html: '<p>123456</p>', text: '123456' },
    });
    fetchMock.mockImplementation(async () => jsonResponse({ message: 'Unauthorized' }, 401));
    expect(await sendEmail(MSG)).toEqual({ sent: false });
  });
});
