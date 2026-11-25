const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const JOKES = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'I told my computer I needed a break. Now it will not stop sending me Kit-Kat ads.',
  'Why did the phone go to school? To become a smartphone.',
  'There are 10 kinds of people: those who understand binary and those who do not.',
  'Why was the math book sad? It had too many problems.',
  'I would tell you a UDP joke, but you might not get it.',
  'Why did the scarecrow win an award? He was outstanding in his field.',
  'My Wi-Fi went down for five minutes, so I talked to my family. They seem nice.',
];

const FACTS = [
  'Honey never spoils. Edible honey has been found in ancient Egyptian tombs.',
  'Octopuses have three hearts and blue blood.',
  'Bananas are berries, but strawberries are not.',
  'A day on Venus is longer than a year on Venus.',
  'Wombat droppings are cube-shaped.',
  'The shortest war in history lasted about 38 minutes.',
  'Sharks existed before trees did.',
  'A bolt of lightning is hotter than the surface of the sun.',
];

const QUOTES = [
  'Small steps every day add up to big results.',
  'Do not wait for the perfect moment. Take the moment and make it perfect.',
  'Discipline is choosing what you want most over what you want now.',
  'You are one decision away from a completely different life.',
  'Progress, not perfection.',
  'Hard work beats talent when talent does not work hard.',
];

const COMPLIMENTS = [
  'You have a great sense of humor. 😄',
  'You make people around you feel welcome. 🌟',
  'You are more capable than you think. 💪',
  'Your kindness is contagious. 💛',
  'You light up the chat when you show up. ✨',
];

const WISHES = [
  'Good night! Sleep well and wake up ready for a great day. 🌙',
  'Sweet dreams! Tomorrow is a fresh start. 🌠',
  'Rest well. You earned it. 😴',
  'Good night! May your dreams be bigger than your worries. 🌌',
];

export default [
  {
    name: 'joke',
    category: 'FUN',
    description: 'A random joke',
    async run({ reply }) {
      await reply(`😂 ${pick(JOKES)}`);
    },
  },
  {
    name: 'fact',
    category: 'FUN',
    description: 'A random fact',
    async run({ reply }) {
      await reply(`🧠 ${pick(FACTS)}`);
    },
  },
  {
    name: 'quote',
    category: 'FUN',
    description: 'A motivational line',
    async run({ reply }) {
      await reply(`💬 ${pick(QUOTES)}`);
    },
  },
  {
    name: 'compliment',
    category: 'FUN',
    description: 'A nice compliment',
    async run({ reply }) {
      await reply(pick(COMPLIMENTS));
    },
  },
  {
    name: 'goodnight',
    category: 'FUN',
    description: 'A good night wish',
    async run({ reply }) {
      await reply(pick(WISHES));
    },
  },
  {
    name: 'ship',
    category: 'FUN',
    description: 'Love match. Example: !ship Ada & Tunde',
    async run({ args, reply }) {
      const parts = args.join(' ').split(/&|\band\b|\+/i).map((s) => s.trim()).filter(Boolean);
      if (parts.length < 2) return reply('Use two names. Example: !ship Ada & Tunde');
      const [a, b] = [parts[0], parts[1]].sort();
      const seed = Array.from(`${a}${b}`.toLowerCase()).reduce((n, c) => n + c.charCodeAt(0), 0);
      const pct = seed % 101;
      const bar = '█'.repeat(Math.round(pct / 10)).padEnd(10, '░');
      await reply(`💘 *${parts[0]}* + *${parts[1]}*\n${bar} ${pct}%`);
    },
  },
];
