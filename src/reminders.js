// Per-channel message tracking
const channelState = new Map();

function buildConfig() {
  const rawIds = process.env.REMINDER_CHANNEL_IDS || "";
  const rawMessages = process.env.REMINDER_MESSAGES || "";
  const threshold = Number(process.env.REMINDER_THRESHOLD || 20);

  const ids = rawIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const msgs = rawMessages
    .split("||") // allows multi-line messages without comma collision
    .map((s) => s.trim());

  const perChannel = new Map();

  ids.forEach((id, index) => {
    const message =
      msgs[index] ||
      "**Reminder:** Please follow the community rules.";

    perChannel.set(id, {
      channelId: id,
      threshold,
      message,
    });
  });

  return { perChannel };
}

export function getReminderConfig() {
  return buildConfig();
}

export async function handleReminderMessage(message, config) {
  const { perChannel } = config;

  // Only watch configured channels
  if (!perChannel.has(message.channel.id)) return;
  if (message.author.bot) return;

  const key = message.channel.id;
  const state = channelState.get(key) || { count: 0 };
  state.count++;

  const cfg = perChannel.get(key);

  if (state.count >= cfg.threshold) {
    state.count = 0;

    // Send final message
    await message.channel.send(cfg.message);
  }

  channelState.set(key, state);
}
