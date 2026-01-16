import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} from "discord.js";

import { getReminderConfig, handleReminderMessage } from "./reminders.js";
import { handleSupportSelectInteraction, handleResolveCommand } from "./tickets.js";

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

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  await handleReminderMessage(message, reminderConfig);
  await handleResolveCommand(message);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleSupportSelectInteraction(interaction, client);
  } catch (err) {
    console.error("Interaction error:", err);
  }
});

client.login(process.env.DISCORD_TOKEN);
