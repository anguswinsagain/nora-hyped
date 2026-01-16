import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import {
  createTicket,
  getOpenTicketForUser,
  getTicketByChannelId,
  closeTicket,
  getPendingReviewTicketForUser,
  saveReview,
} from "./db.js";

const SUPPORT_COLOR = 0x4a07fa;

const CATEGORIES = [
  { id: "player_card", label: "Report a Player or Card", danger: true },
  { id: "appeal", label: "Appeal Moderation Action", danger: true },
  { id: "general", label: "General Support", danger: false },
  { id: "data_loss", label: "Data Loss, Donations, or Player Data", danger: false },
  { id: "bug", label: "Report a Bug", danger: false },
];

const CATEGORY_GUIDANCE = {
  player_card: [
    "You opened a ticket to report a player or card.",
    "",
    "Please provide:",
    "- The player's username and any relevant card links.",
    "- What happened, including time and channel if possible.",
    "- Any screenshots or proof you can share.",
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

const SUPPORT_STAFF_ROLE_ID = process.env.SUPPORT_STAFF_ROLE_ID;
const SUPPORT_CATEGORY_ID = process.env.SUPPORT_CATEGORY_ID;
const SUPPORT_LOG_CHANNEL_ID = process.env.SUPPORT_LOG_CHANNEL_ID;
const SUPPORT_PORTAL_CHANNEL_ID = process.env.SUPPORT_PORTAL_CHANNEL_ID;
const RATING_LOG_CHANNEL_ID = process.env.RATING_LOG_CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;

// Simple in-memory debounce for “Open a ticket”
const lastSupportUiAt = new Map();
const SUPPORT_UI_COOLDOWN_MS = 20_000; // 20 seconds

// ----- Panel + buttons -----

export async function sendSupportPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle("HYPED Support")
    .setDescription(
      [
        "Need help? Use the button below to open a private ticket with the HYPED Team.",
        "",
        "Please only open tickets when you genuinely need assistance.",
      ].join("\n")
    )
    .setColor(SUPPORT_COLOR);

  const openButton = new ButtonBuilder()
    .setCustomId("support_open_ticket")
    .setLabel("Open a Ticket")
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(openButton);

  await channel.send({ embeds: [embed], components: [row] });
}

function buildCategoryRows() {
  const buttons = CATEGORIES.map((cat) =>
    new ButtonBuilder()
      .setCustomId(`support_category:${cat.id}`)
      .setLabel(cat.label)
      .setStyle(cat.danger ? ButtonStyle.Danger : ButtonStyle.Secondary)
  );

  const rows = [];
  let current = [];
  for (const btn of buttons) {
    if (current.length >= 5) {
      rows.push(new ActionRowBuilder().addComponents(current));
      current = [];
    }
    current.push(btn);
  }
  if (current.length) {
    rows.push(new ActionRowBuilder().addComponents(current));
  }
  return rows;
}

// ----- Interaction handlers -----

export async function handleSupportOpenButton(interaction) {
  if (interaction.customId !== "support_open_ticket") return;

  const user = interaction.user;
  const now = Date.now();
  const last = lastSupportUiAt.get(user.id) || 0;
  if (now - last < SUPPORT_UI_COOLDOWN_MS) {
    // silent ignore
    return;
  }
  lastSupportUiAt.set(user.id, now);

  // Single open ticket check
  const openTicket = getOpenTicketForUser(user.id);
  if (openTicket) {
    return interaction.reply({
      content: `You already have an open support ticket: <#${openTicket.ticket_channel_id}>`,
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("How can we help?")
    .setDescription(
      [
        "HYPED Team members will be with you shortly after you open your ticket.",
        "",
        "**Do not open tickets without a legitimate need for assistance. You may lose access to the support system if you abuse it.**",
      ].join("\n")
    )
    .setColor(SUPPORT_COLOR);

  await interaction.reply({
    embeds: [embed],
    components: buildCategoryRows(),
    ephemeral: true,
  });
}

export async function handleSupportCategoryButton(interaction) {
  if (!interaction.customId.startsWith("support_category:")) return;

  const user = interaction.user;

  // Single open ticket check again for safety
  const openTicket = getOpenTicketForUser(user.id);
  if (openTicket) {
    return interaction.reply({
      content: `You already have an open support ticket: <#${openTicket.ticket_channel_id}>`,
      ephemeral: true,
    });
  }

  const [, categoryId] = interaction.customId.split(":");
  const category = CATEGORIES.find((c) => c.id === categoryId);
  if (!category) {
    return interaction.reply({
      content: "This ticket category is no longer available.",
      ephemeral: true,
    });
  }

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

export async function handleSupportModalSubmit(interaction) {
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

  // Single open ticket check again
  const openTicket = getOpenTicketForUser(user.id);
  if (openTicket) {
    return interaction.reply({
      content: `You already have an open support ticket: <#${openTicket.ticket_channel_id}>`,
      ephemeral: true,
    });
  }

  const staffRoleId = SUPPORT_STAFF_ROLE_ID;
  const parentCategoryId = SUPPORT_CATEGORY_ID;

  const description = interaction.fields.getTextInputValue("ticket_description");

  const baseName = user.username
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .slice(0, 80);

  const channelName = `support-${baseName}`;

  const botId = interaction.client.user.id;

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
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

  // DB log
  createTicket({
    channelId: ticketChannel.id,
    userId: user.id,
    category: categoryId,
    initialDescription: description,
  });

  const guidance =
    CATEGORY_GUIDANCE[categoryId] ||
    "A staff member will review your ticket shortly. Please explain your situation clearly.";

  const embed = new EmbedBuilder()
    .setTitle(`Support Ticket – ${category.label}`)
    .setColor(SUPPORT_COLOR)
    .setDescription(
      [
        `Opened by: <@${user.id}>`,
        "",
        "Initial Report (submitted by the user):",
        "```text",
        description,
        "```",
        "",
        guidance,
      ].join("\n")
    );

  await ticketChannel.send({ embeds: [embed] });

  await interaction.reply({
    content: `Your ticket has been created: ${ticketChannel}`,
    ephemeral: true,
  });
}

// ----- /close command + modal -----

export async function handleCloseSlash(interaction) {
  if (interaction.commandName !== "close") return;

  const member = interaction.member;
  if (!member || !member.roles) {
    return interaction.reply({
      content: "This command can only be used inside the server.",
      ephemeral: true,
    });
  }

  if (!SUPPORT_STAFF_ROLE_ID || !member.roles.cache.has(SUPPORT_STAFF_ROLE_ID)) {
    return interaction.reply({
      content: "You do not have permission to close support tickets.",
      ephemeral: true,
    });
  }

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    return interaction.reply({
      content: "This command must be used inside a ticket channel.",
      ephemeral: true,
    });
  }

  const ticket = getTicketByChannelId(channel.id);
  if (!ticket) {
    return interaction.reply({
      content: "This channel is not recognized as a support ticket.",
      ephemeral: true,
    });
  }

  const notes = interaction.options.getString("notes");
  if (notes && notes.trim().length > 0) {
    await performTicketClose(interaction.client, interaction, ticket, notes.trim());
  } else {
    // Show modal to collect notes
    const modal = new ModalBuilder()
      .setCustomId("close_modal")
      .setTitle("Close Ticket – Notes");

    const notesInput = new TextInputBuilder()
      .setCustomId("close_notes")
      .setLabel("Summarize how this ticket was resolved")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(2000);

    const row = new ActionRowBuilder().addComponents(notesInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }
}

export async function handleCloseModalSubmit(interaction) {
  if (interaction.customId !== "close_modal") return;

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    return interaction.reply({
      content: "This command must be used inside a ticket channel.",
      ephemeral: true,
    });
  }

  const ticket = getTicketByChannelId(channel.id);
  if (!ticket) {
    return interaction.reply({
      content: "This channel is not recognized as a support ticket.",
      ephemeral: true,
    });
  }

  const member = interaction.member;
  if (!member || !member.roles || !SUPPORT_STAFF_ROLE_ID || !member.roles.cache.has(SUPPORT_STAFF_ROLE_ID)) {
    return interaction.reply({
      content: "You do not have permission to close support tickets.",
      ephemeral: true,
    });
  }

  const notes = interaction.fields.getTextInputValue("close_notes").trim();
  await performTicketClose(interaction.client, interaction, ticket, notes);
}

async function performTicketClose(client, interaction, ticketRow, notes) {
  const channel = interaction.channel;
  const moderatorId = interaction.user.id;

  // Update DB and mark awaiting_review = 1
  const updatedTicket = closeTicket({
    channelId: channel.id,
    moderatorId,
    resolutionText: notes,
  });

  // Log to support log channel
  if (SUPPORT_LOG_CHANNEL_ID) {
    const logChannel = await client.channels
      .fetch(SUPPORT_LOG_CHANNEL_ID)
      .catch(() => null);

    if (logChannel && logChannel.isTextBased()) {
      const createdAt = updatedTicket.created_at || "unknown";
      const closedAt = updatedTicket.closed_at || "unknown";
      const categoryObj = CATEGORIES.find((c) => c.id === updatedTicket.category);
      const categoryLabel = categoryObj ? categoryObj.label : updatedTicket.category;

      const embed = new EmbedBuilder()
        .setTitle(`Ticket Closed – ${categoryLabel}`)
        .setColor(SUPPORT_COLOR)
        .addFields(
          {
            name: "Ticket Channel",
            value: `<#${updatedTicket.ticket_channel_id}>`,
            inline: true,
          },
          {
            name: "User",
            value: `<@${updatedTicket.user_id}>`,
            inline: true,
          },
          {
            name: "Closed By",
            value: `<@${moderatorId}>`,
            inline: true,
          },
          {
            name: "Created At",
            value: createdAt,
            inline: true,
          },
          {
            name: "Closed At",
            value: closedAt,
            inline: true,
          },
          {
            name: "Initial Report",
            value:
              "```text\n" +
              (updatedTicket.initial_description || "None") +
              "\n```",
          },
          {
            name: "Resolution Notes",
            value: notes ? "```text\n" + notes + "\n```" : "```text\nNone\n```",
          }
        );

      // Transcript
      const transcriptText = await buildTranscriptText(channel);
      const files = [];
      if (transcriptText) {
        const buf = Buffer.from(transcriptText, "utf8");
        files.push({
          attachment: buf,
          name: `ticket-${updatedTicket.id || "log"}.txt`,
        });
      }

      await logChannel.send({ embeds: [embed], files });
    }
  }

  // DM user for review
  try {
    const user = await client.users.fetch(updatedTicket.user_id);
    const guild = GUILD_ID
      ? await client.guilds.fetch(GUILD_ID).catch(() => null)
      : null;
    const closerMember = guild
      ? await guild.members.fetch(moderatorId).catch(() => null)
      : null;

    const closerName = closerMember
      ? `${closerMember.user.username}${closerMember.nickname ? ` (${closerMember.nickname})` : ""}`
      : `<@${moderatorId}>`;

    await user.send(
      [
        "Hi, this is Nora from HYPED Support.",
        "",
        `Your support ticket handled by **${closerName}** has been closed.`,
        "",
        "If you would like, you can reply to this message with brief feedback about your support experience (up to 200 characters).",
        "If other staff members assisted you, feel free to mention them as well.",
      ].join("\n")
    );
  } catch {
    // ignore DM failures
  }

  await interaction.reply({
    content: "Ticket closed. This channel will be deleted in 10 seconds.",
    ephemeral: true,
  });

  setTimeout(() => {
    channel.delete().catch(() => null);
  }, 10_000);
}

// Build plain-text transcript (limited for safety)
async function buildTranscriptText(channel) {
  if (!channel || !channel.isTextBased()) return null;

  const maxMessages = 500;
  const collected = [];

  let lastId = undefined;

  while (collected.length < maxMessages) {
    const batch = await channel.messages.fetch({
      limit: 100,
      before: lastId,
    });

    if (!batch.size) break;

    for (const msg of batch.values()) {
      collected.push(msg);
    }

    lastId = batch.last().id;
    if (batch.size < 100) break;
  }

  if (!collected.length) return null;

  // Oldest first
  collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = collected.map((msg) => {
    const ts = new Date(msg.createdTimestamp)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, "Z");
    const author = msg.author
      ? `${msg.author.username}#${msg.author.discriminator}`
      : "Unknown";
    const displayName =
      msg.member && msg.member.nickname
        ? `${msg.member.nickname}`
        : msg.member && msg.member.displayName
        ? msg.member.displayName
        : msg.author
        ? msg.author.username
        : "Unknown";

    const content = msg.content || "";
    return `[${ts}] ${displayName} (${author}): ${content}`;
  });

  return lines.join("\n");
}

// ----- DM reviews -----

export async function handleReviewDm(client, message) {
  if (message.author.bot) return;
  if (message.guild) return; // only DMs

  const pending = getPendingReviewTicketForUser(message.author.id);
  if (!pending) {
    // silently ignore, as requested
    return;
  }

  const text = message.content.trim();
  if (!text.length) {
    // ignore empty
    return;
  }

  if (text.length > 200) {
    await message.channel.send(
      "Sorry, your review is too long. Try shortening it and I will log your final review."
    );
    return;
  }

  // Save review and stop awaiting
  saveReview({ ticketId: pending.id, reviewText: text });

  // Log to rating log channel
  if (RATING_LOG_CHANNEL_ID) {
    const logChannel = await client.channels
      .fetch(RATING_LOG_CHANNEL_ID)
      .catch(() => null);

    if (logChannel && logChannel.isTextBased()) {
      const guild = GUILD_ID
        ? await client.guilds.fetch(GUILD_ID).catch(() => null)
        : null;

      const closerUser = pending.moderator_id
        ? await client.users.fetch(pending.moderator_id).catch(() => null)
        : null;

      const closerMember =
        guild && pending.moderator_id
          ? await guild.members.fetch(pending.moderator_id).catch(() => null)
          : null;

      const closerDisplay =
        closerMember && closerMember.displayName
          ? closerMember.displayName
          : closerUser
          ? closerUser.username
          : pending.moderator_id || "Unknown";

      const closerTag =
        closerUser && closerUser.discriminator
          ? `${closerUser.username}#${closerUser.discriminator}`
          : closerUser
          ? closerUser.username
          : "Unknown";

      const nowIso = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");

      const block = [
        "```text",
        `Time: ${nowIso}`,
        `Ticket Channel: #${pending.ticket_channel_id}`,
        `User ID: ${pending.user_id}`,
        `Closed By: ${closerDisplay} (${closerTag}) [${pending.moderator_id}]`,
        "",
        "Review:",
        text,
        "```",
      ].join("\n");

      await logChannel.send({ content: block });
    }
  }

  // Acknowledge once
  await message.channel.send("Thank you. Your feedback has been recorded.");
  // future messages are ignored because awaiting_review is now 0
}
