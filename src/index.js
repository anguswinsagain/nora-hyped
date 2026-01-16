import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ApplicationCommandOptionType,
} from "discord.js";

import {
  getReminderConfig,
  handleReminderMessage,
} from "./reminders.js";

import {
  sendSupportPanel,
  handleSupportOpenButton,
  handleSupportCategoryButton,
  handleSupportModalSubmit,
  handleCloseSlash,
  handleCloseModalSubmit,
  handleReviewDm,
} from "./tickets.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const reminderConfig = getReminderConfig();

const SUPPORT_STAFF_ROLE_ID = process.env.SUPPORT_STAFF_ROLE_ID;
const SUPPORT_PORTAL_CHANNEL_ID = process.env.SUPPORT_PORTAL_CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  // Register /close command in the guild
  try {
    if (GUILD_ID) {
      const guild = await client.guilds.fetch(GUILD_ID);
      await guild.commands.create({
        name: "close",
        description: "Close this support ticket",
        options: [
          {
            name: "notes",
            description: "Summary of how this ticket was resolved",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      });
      console.log("Registered /close command.");
    }
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // DMs: handle review flow
  if (!message.guild) {
    await handleReviewDm(client, message);
    return;
  }

  // In-guild: reminders only for now
  await handleReminderMessage(message, reminderConfig);
});

client.on(Events.MessageCreate, async (message) => {
  // Reserved space if you ever want !commands again; currently unused.
});

// Support panel setup command (still text-based, staff only)
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

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
    if (interaction.isButton()) {
      if (interaction.customId === "support_open_ticket") {
        await handleSupportOpenButton(interaction);
      } else if (interaction.customId.startsWith("support_category:")) {
        await handleSupportCategoryButton(interaction);
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("support_modal:")) {
        await handleSupportModalSubmit(interaction);
      } else if (interaction.customId === "close_modal") {
        await handleCloseModalSubmit(interaction);
      }
    } else if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "close") {
        await handleCloseSlash(interaction);
      }
    }
  } catch (err) {
    console.error("Interaction error:", err);
  }
});

client.login(process.env.DISCORD_TOKEN);
