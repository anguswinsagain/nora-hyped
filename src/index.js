import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} from "discord.js";

import {
  getReminderConfig,
  handleReminderMessage,
} from "./reminders.js";

import {
  handleSupportSelectInteraction,
  handleResolveCommand,
  sendSupportPanel,
} from "./tickets.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// reminder config is based on env, built once at startup
const reminderConfig = getReminderConfig();

const SUPPORT_STAFF_ROLE_ID = process.env.SUPPORT_STAFF_ROLE_ID;
const SUPPORT_PORTAL_CHANNEL_ID = process.env.SUPPORT_PORTAL_CHANNEL_ID;

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  // ignore bots (including Nora)
  if (message.author.bot) return;
  if (!message.guild) return; // ignore DMs

  // 1) per-channel reminders
  await handleReminderMessage(message, reminderConfig);

  // 2) ticket resolve command
  await handleResolveCommand(message);

  // 3) support panel setup command (staff-only, correct channel only)
  if (message.content === "!setupSupportPanel") {
    if (!SUPPORT_STAFF_ROLE_ID || !SUPPORT_PORTAL_CHANNEL_ID) {
      return message.reply(
        "Support panel is not configured. Ask an admin to set SUPPORT_STAFF_ROLE_ID and SUPPORT_PORTAL_CHANNEL_ID."
      );
    }

    // must be in the designated support portal channel
    if (message.channel.id !== SUPPORT_PORTAL_CHANNEL_ID) {
      return message.reply(
        "You must run this command in the official support portal channel."
      );
    }

    // must have the staff role
    if (!message.member.roles.cache.has(SUPPORT_STAFF_ROLE_ID)) {
      return message.reply("You don't have permission to run this command.");
    }

    await sendSupportPanel(message.channel);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleSupportSelectInteraction(interaction, client);
  } catch (err) {
    console.error("Interaction error:", err);
  }
});

client.login(process.env.DISCORD_TOKEN);
