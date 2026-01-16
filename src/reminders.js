const channelCounters = new Map();

export function getReminderConfig() {
  const ids =
    process.env.REMINDER_CHANNEL_IDS?.split(",").map((id) => id.trim()) || [];
  const threshold = Number(process.env.REMINDER_THRESHOLD || 20);
  return { channelIds: ids, threshold };
}

export async function handleReminderMessage(message, config) {
  const { channelIds, threshold } = config;

  if (!channelIds.includes(message.channel.id)) return;
  if (message.author.bot) return;

  const key = message.channel.id;
  const current = (channelCounters.get(key) || 0) + 1;
  channelCounters.set(key, current);

  if (current >= threshold) {
    channelCounters.set(key, 0);

    await message.channel.send(
      "🔔 **Reminder:** Please follow the HYPED community guidelines. No harassment, spam, or NSFW content."
    );
  }
}
