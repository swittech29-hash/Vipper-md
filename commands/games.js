const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const TRUTHS = [
  'What is the most embarrassing thing you have done in public?',
  'What is a secret talent nobody knows you have?',
  'What is the last lie you told?',
  'Who was your first crush?',
  'What is your biggest fear?',
  'What is the worst gift you have ever received?',
];

const DARES = [
  'Send a voice note singing your favorite song.',
  'Change your status to "I love pineapple pizza" for one hour.',
  'Say the alphabet backwards in one voice note.',
  'Send a selfie making your funniest face.',
  'Text the 5th contact in your list "You are awesome".',
  'Do 15 jumping jacks and tell us when you are done.',
];

const BALL = [
  'Yes, definitely.', 'It is certain.', 'Most likely.', 'Signs point to yes.',
  'Ask again later.', 'Cannot predict now.', 'Do not count on it.',
  'My answer is no.', 'Very doubtful.',
];

const RPS = { rock: '🪨', paper: '📄', scissors: '✂️' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export default [
  {
    name: 'rps',
    category: 'GAMES',
    description: 'Rock paper scissors. Example: !rps rock',
    async run({ args, reply }) {
      const me = (args[0] || '').toLowerCase();
      if (!RPS[me]) return reply('Choose one: !rps rock, !rps paper or !rps scissors');
      const bot = pick(Object.keys(RPS));
      const result = me === bot ? "It's a draw! 🤝" : BEATS[me] === bot ? 'You win! 🎉' : 'I win! 😎';
      await reply(`You: ${RPS[me]}\nMe: ${RPS[bot]}\n\n${result}`);
    },
  },
  {
    name: 'slots',
    category: 'GAMES',
    description: 'Spin the slot machine',
    async run({ reply }) {
      const icons = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'];
      const r = [pick(icons), pick(icons), pick(icons)];
      const win = r[0] === r[1] && r[1] === r[2];
      const two = !win && (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]);
      await reply(`🎰 ${r.join(' | ')}\n\n${win ? 'JACKPOT! 🎉' : two ? 'So close! Two match. 🙂' : 'No match. Try again!'}`);
    },
  },
  {
    name: 'truth',
    category: 'GAMES',
    description: 'A truth question',
    async run({ reply }) {
      await reply(`🤔 *Truth:* ${pick(TRUTHS)}`);
    },
  },
  {
    name: 'dare',
    category: 'GAMES',
    description: 'A dare',
    async run({ reply }) {
      await reply(`😈 *Dare:* ${pick(DARES)}`);
    },
  },
  {
    name: '8ball',
    category: 'GAMES',
    description: 'Ask the magic 8-ball',
    async run({ args, reply }) {
      if (!args.length) return reply('Ask a question. Example: !8ball Will I pass?');
      await reply(`🎱 ${pick(BALL)}`);
    },
  },
  {
    name: 'dice',
    category: 'GAMES',
    description: 'Roll a dice',
    async run({ reply }) {
      await reply(`🎲 You rolled a *${1 + Math.floor(Math.random() * 6)}*`);
    },
  },
  {
    name: 'coin',
    category: 'GAMES',
    description: 'Flip a coin',
    async run({ reply }) {
      await reply(Math.random() < 0.5 ? '🪙 Heads!' : '🪙 Tails!');
    },
  },
  {
    name: 'random',
    category: 'GAMES',
    description: 'Random number. Example: !random 1 100',
    async run({ args, reply }) {
      let min = Number(args[0] ?? 1);
      let max = Number(args[1] ?? 100);
      if (!Number.isInteger(min) || !Number.isInteger(max)) return reply('Use whole numbers. Example: !random 1 100');
      if (min > max) [min, max] = [max, min];
      await reply(`🔢 ${min + Math.floor(Math.random() * (max - min + 1))}`);
    },
  },
  {
    name: 'pick',
    category: 'GAMES',
    description: 'Pick one option. Example: !pick pizza | rice | beans',
    async run({ args, reply }) {
      const options = args.join(' ').split('|').map((s) => s.trim()).filter(Boolean);
      if (options.length < 2) return reply('Give 2 or more options split by |. Example: !pick pizza | rice');
      await reply(`🎯 I pick: *${pick(options)}*`);
    },
  },
];
