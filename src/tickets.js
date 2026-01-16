import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import {
  logTicketCreation,
  logTicketResolution,
} from "./db.js";

const CATEGORIES = [
  { id: "player_card", label: "Report a Player or Card" },
  { id: "staff_abuse", label: "Report Staff Abuse" },
  { id: "appeal", label: "Appeal Moderation Action" },
  { id: "general", label: "General Support" },
  { id: "data_loss", label: "Data Loss, Donations, or Player Data" },
  { id: "bug", label: "Report a Bug" },
];

// Nora preset guidance per category (no emojis)
const CATEGORY_PRESETS = {
  player_card: [
    "You opened a ticket to report a player or card.",
    "",
    "Please provide:",
    "- The player's username and any relevant card links.",
    "- What happened, including time and channel if possible.",
    "- Any screenshots or proof you can share.",
  ].join("\n"),

  staff_abuse: [
    "You opened a ticket to report staff abuse.",
    "",
    "Please provide:",
    "- The staff member's username.",
    "- A clear description of what happened.",
    "- Screenshots or proof if available.",
  ].join("\n"),

  appeal: [
    "You opened a ticket to appeal a moderation action.",
    "",
    "Please provide:",
    "- What action was taken against you (mute, warn, timeout, ban, etc.).",
    "- When it happened.",
    "- Why you believe it should be reviewed or lifted.",
  ].join("\n"),

  general: [
    "You opened a general support ticket.",
    "",
    "Feel free to explain your question or request in detail.",
  ].join("\n"),

  data_loss: [
    "You opened a ticket about data loss, donations, or player data.",
    "",
    "Please provide:",
    "- Your Roblox username.",
    "- What was lost (donation, player data, etc.).",
    "- Approximately when it happened.",
  ].join("\n"),

  bug: [
    "You opened a ticket to report a bug.",
    "",
    "Please provide:",
    "- What you were doing when the bug happened.",
    "- Whether you can reproduce it consistently.",
    "- Screenshots or steps to reproduce, if possible.",
  ].join("\n"),
};

export function buildSupportPanelRow() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("support_select")
    .setPlaceholder("Choose a support category…")
    .addOptions(
      CATEGORIES.map((c) => ({
        label: c.label,
        value: c.id,
      }))
    );

  return new ActionRowBuilder().addComponents(select);
}

export async function sendSupportPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle("HYPED Support Portal")
    .setDescription(
      [
        "Need help? Use the menu below to open a private ticket with staff.",
        "",
        "Available categories:",
        "- Report a Player or Card",
        "- Report Staff Abuse",
        "- Appeal Moderation Action",
        "- General Support",
        "- Data Loss, Donations, or Player Data",
        "- Report a Bug",
      ].join("\n")
    )
    .setColor(0x5865f2);

  await channel.send({
    embeds: [embed],
    components: [buildSupportPanelRow()],
  });
}

// When user picks a category in the dropdown, show a modal to collect their text
export async function handleSupportSelectInteraction(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== "support_select") return;

  const categoryId = interaction.values[0];
  const category = CATEGORIES.find((c) => c.id === categoryId);
  if (!category) return;

  const modal = new ModalBuilder()
    .setCustomId(`support_modal:${categoryId}`)
    .setTitle(`HYPED Support – ${category.label}`);

  const descriptionInput = new TextInputBuilder()
    .setCustomId("ticket_description")
    .setLabel("Describe your issue or request")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);

  const row = new ActionRowBuilder().addComponents(descriptionInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

// Handle the modal submission: create the ticket channel, log, and send presets
export async function handleSupportModalSubmit(interaction) {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("support_modal:")) return;

  const [, categoryId] = interaction.customId.split(":");
  const category = CATEGORIES.find((c) => c.id === categoryId);
  if (!category) {
    return interaction.reply({
      content: "This ticket category is no longer available.",
      ephemeral: true,
    });
  }

  const guild = interaction.guild;
  const user = interaction.user;

  if (!guild) {
    return interaction.reply({
      content: "Tickets can only be created inside a server.",
      ephemeral: true,
    });
  }

  const staffRoleId = process.env.SUPPORT_STAFF_ROLE_ID;
  const parentCategoryId = process.env.SUPPORT_CATEGORY_ID;

  const description = interaction.fields.getTextInputValue("ticket_description");

  const channelName = `ticket-${categoryId}-${user.username}`
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .slice(0, 90);

  const botId = interaction.client.user.id;

  const permissionOverwrites = [
    // Everyone cannot see the ticket
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    // The user who opened the ticket
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    // Nora (the bot) needs to see and send in the channel
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  if (staffRoleId) {
    permissionOverwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: parentCategoryId || undefined,
    permissionOverwrites,
  });


  // Log creation with initial description
  logTicketCreation({
    channelId: ticketChannel.id,
    userId: user.id,
    category: categoryId,
    initialDescription: description,
  });

  const preset =
    CATEGORY_PRESETS[categoryId] ||
    "A staff member will review your ticket shortly. Please explain your situation clearly.";

  // Send Nora's preset guidance and the user's text into the ticket
  await ticketChannel.send(
    [
      `Ticket created for <@${user.id}> – ${category.label}`,
      "",
      "Your message:",
      description,
      "",
      preset,
    ].join("\n")
  );

  await interaction.reply({
    content: `Your ticket has been created: ${ticketChannel}`,
    ephemeral: true,
  });
}

export async function handleResolveCommand(message) {
  if (!message.guild) return;
  if (!message.content.startsWith("!resolve")) return;

  const staffRoleId = process.env.SUPPORT_STAFF_ROLE_ID;
  if (!staffRoleId) {
    return message.reply("SUPPORT_STAFF_ROLE_ID is not configured.");
  }

  if (!message.member.roles.cache.has(staffRoleId)) {
    return message.reply("You do not have permission to resolve tickets.");
  }

  const summary = message.content.replace("!resolve", "").trim();

  logTicketResolution({
    channelId: message.channel.id,
    moderatorId: message.author.id,
    resolutionText: summary || null,
  });

  await message.channel.send(
    "Ticket resolved. This channel will be deleted in 10 seconds."
  );

  setTimeout(() => {
    message.channel.delete().catch(() => {});
  }, 10_000);
}
