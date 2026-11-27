// VIPPER MD - App JSON Template Command
export default [
  {
    name: 'appjson',
    aliases: ['app-json', 'jsonapp'],
    category: 'TOOLS',
    description: 'Generate and validate JSON templates',

    async run({ args, msg, reply }) {
      const action = (args[0] || 'help').toLowerCase();

      if (action === 'help') {
        return reply(
          '📦 *APP JSON COMMAND*\n\n' +
          '• !appjson template\n' +
          '• !appjson website\n' +
          '• !appjson validate <JSON>\n' +
          '• !appjson raw <JSON>\n\n' +
          'Reply to a JSON message to validate or format it.'
        );
      }

      const templates = {
        template: {
          type: 'template',
          title: 'Example title',
          body: 'Your message goes here.',
          footer: 'VIPPER MD',
          actions: [
            {
              label: 'Example action',
              command: '!help'
            }
          ]
        },

        website: {
          name: 'VIPPER MD',
          description: 'WhatsApp bot configuration',
          version: '1.0.0',
          commands: [],
          settings: {
            prefix: '!',
            theme: 'dark'
          }
        }
      };

      if (templates[action]) {
        return reply(
          '📄 *JSON TEMPLATE*\n\n```json\n' +
          JSON.stringify(templates[action], null, 2) +
          '\n```'
        );
      }

      const supplied = args.slice(1).join(' ').trim();

      const quotedMsg =
        msg?.message?.ephemeralMessage?.message ||
        msg?.message;

      const quoted =
        quotedMsg?.extendedTextMessage?.contextInfo?.quotedMessage;

      const quotedText =
        quoted?.conversation ||
        quoted?.extendedTextMessage?.text ||
        '';

      const input = supplied || quotedText.trim();

      if (action === 'validate' || action === 'raw') {
        if (!input) {
          return reply(
            '❌ Send JSON after the command.\n\n' +
            'Example:\n!appjson validate {"name":"VIPPER"}'
          );
        }

        let parsed;

        try {
          parsed = JSON.parse(input);
        } catch (err) {
          return reply('❌ Invalid JSON:\n' + err.message);
        }

        if (action === 'validate') {
          const type = Array