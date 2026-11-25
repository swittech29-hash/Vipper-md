
module.exports = async (sock, m) => {
  try {
    const chat = m.key.remoteJid;

    await sock.sendMessage(
      chat,
      {
        text: "✅ Anti-Tag All command is working!"
      },
      { quoted: m }
    );

  } catch (error) {
    console.error("Anti-Tag All Error:", error);
  }
};
