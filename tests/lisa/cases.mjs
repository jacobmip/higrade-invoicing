// Real conversations Lisa got wrong, replayed before every push that touches
// her (Jake, 2026-11-14: "You need to test it better and avoid things like
// this from ever happening"). Each case is the thread she is answering, what
// she knows about the customer, and the checks her reply must pass.
//
// Add a case every time Lisa makes a mistake with a customer. Names and
// numbers are real customers' shapes, not their data: phones are 555 numbers.
//
// Dates are relative so the cases never go stale: day(1) is the next weekday.

import { clientFacts, historyBlock } from '../../api/_lib/client-history.js';

function hstToday() {
  return new Date(Date.now() - 10 * 3600e3);
}
/** YYYY-MM-DD of the nth weekday from today (n=0 is today). */
export function day(n) {
  const d = hstToday();
  let left = n;
  while (left > 0 || [0, 6].includes(d.getUTCDay())) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![0, 6].includes(d.getUTCDay())) left--;
  }
  return d.toISOString().slice(0, 10);
}
const spoken = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
/** An ISO timestamp n hours ago. */
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const msg = (direction, body, hoursAgo) => ({ direction, body, created_at: ago(hoursAgo), media: null });
const hist = (channel, who, body, hoursAgo) => ({ at: ago(hoursAgo), channel, who, body });

// Phrases no reply should ever contain, on top of each case's own checks.
export const ALWAYS_BANNED = [
  [/our team will confirm your time/i, 'canned "team will confirm" line'],
  [/\b(Jake|Jacob)\b/, 'named the owner'],
  [/—|–/, 'em or en dash'],
];

const ASKS_ADDRESS = /\b(what('?s| is)|send|share|confirm|provide)\b[^.?!]{0,40}\b(service )?address\b/i;
// Greeting or thanking "Neil" alone ("Mahalo Neil", "Sorry for the mix-up, Neil"),
// not mentioning Neil's number.
const NEIL_ALONE = /(^|\b(aloha|mahalo|thanks|thank you|hi|sorry[^.?!]{0,30}))[,!]?\s+Neil\b(?!'s|\s*(&|and)\s*Mari)/i;

const HANNAHS = {
  name: 'Neil & Mariane Hannahs', first_name: 'Neil & Mariane', last_name: 'Hannahs',
  mobile: '+18085550142', phone: '+18085550143',
  address1: '4545A Sierra Dr', address2: 'Honolulu HI', address3: '96816',
};

export function cases() {
  const d1 = day(1);
  const booked = { start: `${d1}T16:30`, what: '', doc: 'EST1211', on_calendar: true };
  const hannahsHistory = [
    hist('call', 'Lisa', 'Missed call, customer hung up (12s)', 100),
    hist('text', 'customer', 'Aloha, mahalo nui for following up. The upstairs water pressure in only one bathroom has been decreasing (2 sinks and the shower). Also the fridge water valve in the wall is broken per the appliance tech.', 30),
    hist('text', 'Lisa', "Glad to hear from you. What's the service address?", 30),
    hist('text', 'customer', '4545A Sierra Dr. Weʻre in Kaimukī.', 30),
    hist('text', 'Lisa', 'And what name should I put this under?', 30),
    hist('text', 'customer', 'Neil & Mariane Hannahs. Please include his contact # on our texts. (808)555-0143', 30),
    hist('text', 'customer', 'Tuesdays, Thursdays, Fridays or weekends. We are the home in back down the driveway.', 29),
    hist('text', 'customer', 'Fridge valve taken care of, just need to resolve water pressure issue.', 29),
    hist('text', 'Lisa', `You're firmly booked for ${spoken(d1)} at 4:30 PM at 4545A Sierra Dr, the home in back down the driveway. Clearing under the two sinks would help.`, 29),
    hist('text', 'customer', 'Confirmed', 29),
    hist('call', 'Lisa', `Marianne called to confirm her appointment ${spoken(d1)} at 4:30 PM at 4545A Sierra Drive. The call was forwarded. (74s)`, 1),
  ];

  return [
    {
      name: 'booked couple replies with address and problem after a call',
      why: 'Marianne, 2026-11-13: her address+problem reply was saved as the street and answered "Our team will confirm your time"',
      thread: [msg('inbound', '4545A Sierra Dr.   \nLow water pressure in upstairs bathroom faucets.', 0.05)],
      facts: HANNAHS, history: hannahsHistory, visits: [booked],
      open: { date: `${d1}T16:30`, problem: 'Low water pressure, upstairs bathroom' },
      mustNot: [[ASKS_ADDRESS, 'asked for an address we have'], [NEIL_ALONE, 'called the couple "Neil" alone'], [/\b(3|9)(:00)? ?(PM|AM)\b/i, 'named a time other than 4:30']],
      must: [[/4:30/, 'did not state the booked 4:30']],
      expect: 'Acknowledges the address and the water pressure issue, confirms the existing 4:30 PM visit, does not treat them as a new lead or ask for anything already on file.',
    },
    {
      name: 'booked customer adds a detail; their own time is never "taken"',
      why: 'Neil, 2026-11-12: booked for 3 PM, his next text got "That time\'s taken, we have 4:30"',
      thread: [
        msg('inbound', 'Tomorrow is ok @ 9 am. Is there any prep work that we need to do? (like clearing under the sinks)', 0.2),
        msg('outbound', `You're all set for ${spoken(d1)} at 3 PM. Clearing under those two sinks would help. Mahalo!`, 0.19),
        msg('inbound', 'Fridge valve taken care of, just need to resolve water pressure issue.', 0.1),
      ],
      facts: HANNAHS, history: hannahsHistory.slice(0, 7),
      visits: [{ start: `${d1}T15:00`, what: '', doc: 'EST1211', on_calendar: true }],
      open: { date: `${d1}T15:00`, problem: 'Low water pressure, upstairs bathroom' },
      mustNot: [[/\btaken\b|booked up|not available|no longer/i, 'called their own visit taken'], [/4:30/, 'moved them to 4:30'], [NEIL_ALONE, 'called the couple "Neil" alone']],
      must: [[/\b3(:00)? ?PM\b/i, 'did not keep 3 PM']],
      expect: 'Notes that only the water pressure needs doing and keeps the 3 PM visit exactly as booked.',
    },
    {
      name: 'couple gives a second number',
      why: 'Marianne, 2026-11-12: "I\'ve noted Neil\'s number" (nothing stored it), then "Mahalo Neil"',
      thread: [
        msg('inbound', 'Aloha, the upstairs water pressure in one bathroom has been decreasing.', 0.3),
        msg('outbound', "Glad to hear from you. What's the service address?", 0.29),
        msg('inbound', '4545A Sierra Dr. Weʻre in Kaimukī.', 0.2),
        msg('outbound', 'Mahalo. And what name should I put this under?', 0.19),
        msg('inbound', 'Neil & Mariane Hannahs.  Please include his contact # on our texts.  (808)555-0143', 0.05),
      ],
      facts: null, history: [], visits: [],
      mustNot: [[/\bI'?ve (noted|saved|added)\b/i, 'claimed to have saved the number'], [NEIL_ALONE, 'called the couple "Neil" alone']],
      must: [],
      expect: 'Uses both names or none, says the second number will be passed to the team (not that it was saved), and moves on to scheduling.',
    },
    {
      name: '"install it" a day after an estimate',
      why: 'Zoe, 2026-11-12: 21 hours after EST1209 she asked when we can install it and got "What would you like us to install?"',
      thread: [msg('inbound', 'When are you available to come and install it?', 0.05)],
      facts: { name: 'Zoe', first_name: 'Zoe', mobile: '+18085550144' },
      history: [
        hist('text', 'customer', 'Hi, can you quote installing a recessed ice maker box behind my fridge? The water line is already there.', 22),
        hist('text', 'Lisa', 'We can do that. We will put an estimate together and text you the link.', 22),
        hist('text', 'HI Grade', 'Sent estimate EST1209', 21),
      ],
      extraHistory: 'ESTIMATES ALREADY SENT TO THIS CUSTOMER (the link to each is in the thread):\n- EST1209, sent yesterday, not approved yet, not scheduled: Install recessed ice maker outlet box (cut wall, mount box, connect existing water line)',
      visits: [],
      mustNot: [[/what (is it|would you like|do you need|are we)|which (job|project)/i, 'asked what "it" is'], [/approv/i, 'asked for approval before scheduling']],
      must: [],
      expect: 'Understands "it" is the ice maker box from EST1209 and offers times to install it.',
    },
    {
      name: 'booked customer says thanks',
      why: 'Michael, 2026-11-03: "Thanks" echoed his own time and got "We\'re booked up Tuesday" ("Lisa, you lying AI")',
      thread: [
        msg('outbound', `You're set for ${spoken(d1)} at 10 AM. Mahalo!`, 0.2),
        msg('inbound', `Thanks! ${spoken(d1)} at 10 works.`, 0.05),
      ],
      facts: { name: 'Michael Rollins', first_name: 'Michael', last_name: 'Rollins', mobile: '+18085550145', address1: '1020 Green St', address2: 'Honolulu HI', address3: '96822' },
      history: [hist('text', 'customer', 'Water heater leaking from the bottom.', 2)],
      visits: [{ start: `${d1}T10:00`, what: '', doc: 'EST1100', on_calendar: true }],
      open: { date: `${d1}T10:00`, problem: 'Water heater leaking' },
      mustNot: [[/booked up|\btaken\b|not available|fully booked/i, 'called their own visit unavailable']],
      must: [],
      expect: 'A short, warm confirmation of the existing visit. Nothing about availability.',
    },
    {
      name: 'returning customer with a new problem',
      why: 'Lisa must remember customers: never ask a known customer for the address on file',
      thread: [msg('inbound', 'Hi, our kitchen sink is draining really slow again. Can someone come take a look?', 0.05)],
      facts: { name: 'Hannah Han', first_name: 'Hannah', last_name: 'Han', mobile: '+18085550146', address1: '1020 Green St', address2: 'Honolulu HI', address3: '96822' },
      history: [
        hist('text', 'customer', 'Kitchen sink clogged, can you come today?', 24 * 120),
        hist('text', 'Lisa', 'We can. What is the service address?', 24 * 120),
        hist('text', 'customer', '1020 Green St', 24 * 120),
        hist('text', 'HI Grade', 'Sent invoice INV0901', 24 * 118),
      ],
      visits: [],
      mustNot: [[ASKS_ADDRESS, 'asked for the address on file'], [/what('?s| is) your name/i, 'asked the name on file']],
      must: [],
      expect: 'Recognises a returning customer (it can mention the earlier clog), uses the address on file or confirms it, and moves to scheduling.',
    },
  ].map((c) => ({
    ...c,
    historyText: [clientFacts(c.facts), historyBlock(c.history), c.extraHistory].filter(Boolean).join('\n\n'),
  }));
}
