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
  handleSupportModalSubmit,
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

const reminderConfig = getReminderConfig();

const SUPPORT_STAFF_ROLE_ID = process.env.SUPPORT_STAFF_ROLE_ID;
const SUPPORT_PORTAL_CHANNEL_ID = process.env.SUPPORT_PORTAL_CHANNEL_ID;

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  await handleReminderMessage(message, reminderConfig);
  await handleResolveCommand(message);

  if (message.content === "!setupSupportPanel") {
    if (!SUPPORT_STAFF_ROLE_ID || !SUPPORT_PORTAL_CHANNEL_ID) {
      return message.reply(
        "Support panel is not configured. Ask an admin to set SUPPORT_STAFF_ROLE_ID and SUPPORT_PORTAL_CHANNEL_ID."
      );
    }

    if (message.channel.id !== SUPPORT_PORTAL_CHANNEL_ID) {
      return message.reply(
        "You must run this command in the official support portal channel."
      );
    }

    if (!message.member.roles.cache.has(SUPPORT_STAFF_ROLE_ID)) {
      return message.reply("You do not have permission to run this command.");
    }

    await sendSupportPanel(message.channel);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isStringSelectMenu()) {
      await handleSupportSelectInteraction(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleSupportModalSubmit(interaction);
    }
  } catch (err) {
    console.error("Interaction error:", err);
  }
});

client.login(process.env.DISCORD_TOKEN);
