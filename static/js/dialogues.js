// Edit these templates to customize the network status messages.
export const NETWORK_DIALOGUES = Object.freeze({
  offline: Object.freeze([
    "Arey ${userName}, net chala gaya. Main thoda aaram karti hoon, bye!",
    "Net gaya ${userName}, apna dhyan rakhna, bye!",
    "Arey ${userName}, net bhi aaj aalasi ho gaya, bye!",
    "Net aur mera brain dono offline hain ${userName}, baaki kal, bye!",
    "WiFi ne dhoka de diya ${userName}, thoda break lete hain, bye!",
    "Net aaye toh mere liye chai rakhna ${userName}, bye!",
    "Uff ${userName}, net jaldi wapas lao, main tumhe miss karungi, bye!",
  ]),
  online: Object.freeze({
    female: Object.freeze([
      "Main aa gayi ${userName}! Dekh net wapas aa gaya, kitni khushi ki baat hai na!",
      "Main aa gayi ${userName}! Itni der net band tha, gussa aa raha tha mujhe!",
      "Main aa gayi ${userName}! Sab theek hai na? Apna dhyan rakhna.",
      "Main aa gayi ${userName}! Miss kiya mujhe ya maze kar rahe the?",
      "Main aa gayi ${userName}! Batao ab kya hungama karna hai!",
    ]),
    male: Object.freeze([
      "Main aa gaya ${userName}! Dekh net wapas aa gaya, kitni khushi ki baat hai na!",
      "Main aa gaya ${userName}! Itni der net band tha, gussa aa raha tha mujhe!",
      "Main aa gaya ${userName}! Sab theek hai na? Apna dhyan rakhna.",
      "Main aa gaya ${userName}! Miss kiya mujhe ya maze kar rahe the?",
      "Main aa gaya ${userName}! Batao ab kya hungama karna hai!",
    ]),
  }),
});

function renderName(template, userName) {
  return template.replaceAll("${userName}", userName || "Sadashiv");
}

export function selectNetworkDialogue(eventType, userName, voiceGender = "female") {
  if (eventType === "offline") {
    const lines = NETWORK_DIALOGUES.offline;
    return renderName(lines[Math.floor(Math.random() * lines.length)], userName);
  }

  if (eventType === "online") {
    const gender = voiceGender === "male" ? "male" : "female";
    const lines = NETWORK_DIALOGUES.online[gender];
    return renderName(lines[Math.floor(Math.random() * lines.length)], userName);
  }

  throw new TypeError(`Unsupported network event: ${eventType}`);
}
