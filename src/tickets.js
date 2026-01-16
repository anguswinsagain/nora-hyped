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
  MessageFlags,
} from "discord.js";

import {
  createTicket,
  getOpenTicketForUser,
  getTicketByChannelId,
  closeTicket,
  getPendingReviewTicketForUser,
  setReviewLongWarned,
  setReviewDraft,
  clearReviewDraft,
  finalizeReview,
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
    "Please explain your question or request in detail.",
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

const lastSupportUiAt = new Map();
const SUPPORT_UI_COOLDOWN_MS = 20_000;

// ---- Review buttons ----
function reviewButtons(ticketId) {
  const submit = new ButtonBuilder()
    .setCustomId(`review_submit:${ticketId}`)
    .setLabel("Submit review")
    .setStyle(ButtonStyle.Primary); // blurple

  const notReady = new ButtonBuilder()
    .setCustomId(`review_not_ready:${ticketId}`)
    .setLabel("I'm not ready yet")
    .setStyle(ButtonStyle.Danger);

  return [new ActionRowBuilder().addComponents(submit, notReady)];
}

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

  await channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(openButton)],
  });
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
  if (current.length) rows.push(new ActionRowBuilder().addComponents(current));
  return rows;
}

export async function handleSupportOpenButton(interaction) {
  if (interaction.customId !== "support_open_ticket") return;

  const user = interaction.user;
  const now = Date.now();
  const last = lastSupportUiAt.get(user.id) || 0;
  if (now - last < SUPPORT_UI_COOLDOWN_MS) return;
  lastSupportUiAt.set(user.id, now);

  const openTicket = getOpenTicketForUser(user.id);
  if (openTicket) {
    return interaction.reply({
      content: `You already have an open support ticket: <#${openTicket.ticket_channel_id}>`,
      flags: MessageFlags.Ephemeral,
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
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleSupportCategoryButton(interaction) {
  if (!interaction.customId.startsWith("support_category:")) return;

  const user = interaction.user;
  const openTicket = getOpenTicketForUser(user.id);
  if (openTicket) {
    return interaction.reply({
      content: `You already have an open support ticket: <#${openTicket.ticket_channel_id}>`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const [, categoryId] = interaction.customId.split(":");
  const category = CATEGORIES.find((c) => c.id === categoryId);
  if (!category) {
    return interaction.reply({
      content: "This ticket category is no longer available.",
      flags: MessageFlags.Ephemeral,
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

  modal.addComponents(new ActionRowBuilder().addComponents(descriptionInput));
  await interaction.showModal(modal);
}

export async function handleSupportModalSubmit(interaction) {
  if (!interaction.customId.startsWith("support_modal:")) return;

  const [, categoryId] = interaction.customId.split(":");
  const category = CATEGORIES.find((c) => c.id === categoryId);
  if (!category) {
    return interaction.reply({
      content: "This ticket category is no longer available.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const guild = interaction.guild;
  const user = interaction.user;
  if (!guild) {
    return interaction.reply({
      content: "Tickets can only be created inside a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const openTicket = getOpenTicketForUser(user.id);
  if (openTicket) {
    return interaction.reply({
      content: `You already have an open support ticket: <#${openTicket.ticket_channel_id}>`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const description = interaction.fields.getTextInputValue("ticket_description");

  const baseName = user.username
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .slice(0, 80);

  const channelName = `support-${baseName}`;
  const botId = interaction.client.user.id;

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
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

  if (SUPPORT_STAFF_ROLE_ID) {
    permissionOverwrites.push({
      id: SUPPORT_STAFF_ROLE_ID,
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
    parent: SUPPORT_CATEGORY_ID || undefined,
    permissionOverwrites,
  });

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
    flags: MessageFlags.Ephemeral,
  });
}

// ----- /close -----

export async function handleCloseSlash(interaction) {
  if (interaction.commandName !== "close") return;

  const member = interaction.member;
  if (!member || !member.roles) {
    return interaction.reply({
      content: "This command can only be used inside the server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!SUPPORT_STAFF_ROLE_ID || !member.roles.cache.has(SUPPORT_STAFF_ROLE_ID)) {
    return interaction.reply({
      content: "You do not have permission to close support tickets.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    return interaction.reply({
      content: "This command must be used inside a ticket channel.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const ticket = getTicketByChannelId(channel.id);
  if (!ticket) {
    return interaction.reply({
      content: "This channel is not recognized as a support ticket.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const notes = interaction.options.getString("notes");
  if (notes && notes.trim().length > 0) {
    await performTicketClose(interaction.client, interaction, ticket, notes.trim());
  } else {
    const modal = new ModalBuilder()
      .setCustomId("close_modal")
      .setTitle("Close Ticket – Notes");

    const notesInput = new TextInputBuilder()
      .setCustomId("close_notes")
      .setLabel("Summarize how this ticket was resolved")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(2000);

    modal.addComponents(new ActionRowBuilder().addComponents(notesInput));
    await interaction.showModal(modal);
  }
}

export async function handleCloseModalSubmit(interaction) {
  if (interaction.customId !== "close_modal") return;

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    return interaction.reply({
      content: "This command must be used inside a ticket channel.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const ticket = getTicketByChannelId(channel.id);
  if (!ticket) {
    return interaction.reply({
      content: "This channel is not recognized as a support ticket.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const member = interaction.member;
  if (!member || !member.roles || !SUPPORT_STAFF_ROLE_ID || !member.roles.cache.has(SUPPORT_STAFF_ROLE_ID)) {
    return interaction.reply({
      content: "You do not have permission to close support tickets.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const notes = interaction.fields.getTextInputValue("close_notes").trim();
  await performTicketClose(interaction.client, interaction, ticket, notes);
}

async function performTicketClose(client, interaction, ticketRow, notes) {
  const channel = interaction.channel;
  const moderatorId = interaction.user.id;

  const updatedTicket = closeTicket({
    channelId: channel.id,
    moderatorId,
    resolutionText: notes,
  });

  // (ticket logging unchanged in your working version; leaving as-is)
  // ... your existing log+transcript code can stay here exactly ...

  // DM user for review (same as before, but slightly tighter)
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
      : `the HYPED Support Team`;

    await user.send(
      [
        "Hi, this is Nora from HYPED Support.",
        "",
        `Your support ticket has been closed by **${closerName}**.`,
        "",
        "If you would like, reply with brief feedback about your support experience (200 characters maximum).",
        "If other staff members assisted you, you may mention them as well.",
      ].join("\n")
    );
  } catch {
    // ignore DM failures
  }

  await interaction.reply({
    content: "Ticket closed. This channel will be deleted in 10 seconds.",
    flags: MessageFlags.Ephemeral,
  });

  setTimeout(() => channel.delete().catch(() => null), 10_000);
}

// ----- DM reviews (updated flow) -----

export async function handleReviewDm(client, message) {
  if (message.author.bot) return;
  if (message.guild) return;

  const pending = getPendingReviewTicketForUser(message.author.id);
  if (!pending) return; // silent ignore

  const text = message.content.trim();
  if (!text.length) return;

  // If user keeps sending >200, warn only once until they send a valid draft
  if (text.length > 200) {
    if (pending.review_long_warned) {
      // silent ignore (your requested burst-proof behavior)
      return;
    }

    await message.channel.send(
      "Sorry, your review is too long. Please shorten it to 200 characters or less and send it again."
    );

    setReviewLongWarned(pending.id, true);
    console.log(`[Reviews] Too-long warning sent for ticket=${pending.id} user=${message.author.id}`);
    return;
  }

  // Store draft and ask for confirmation via buttons
  setReviewDraft(pending.id, text);
  console.log(`[Reviews] Draft received ticket=${pending.id} user=${message.author.id} len=${text.length}`);

  const confirmMsg = [
    "Thanks — here is the review draft I will submit:",
    "",
    "```text",
    text,
    "```",
    "",
    "Are you sure you want to submit this review?",
    "**Illegitimate reviews will be ignored.**",
  ].join("\n");

  await message.channel.send({
    content: confirmMsg,
    components: reviewButtons(pending.id),
  });
}

export async function handleReviewButton(interaction) {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("review_")) return;

  // Only relevant in DMs
  if (interaction.guild) return;

  const [action, ticketIdStr] = interaction.customId.split(":");
  const ticketId = Number(ticketIdStr);
  if (!Number.isFinite(ticketId)) return;

  const pending = getPendingReviewTicketForUser(interaction.user.id);
  if (!pending) {
    // silent-ish
    return interaction.reply({
      content: "This review is no longer pending.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Ensure they are clicking for their own pending ticket
  if (pending.id !== ticketId) {
    return interaction.reply({
      content: "That review is not pending for your account.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === "review_not_ready") {
    clearReviewDraft(pending.id);

    await interaction.reply({
      content:
        "No problem. When you are ready, send your edited review here. Remember: 200 characters maximum.",
      flags: MessageFlags.Ephemeral,
    });
    console.log(`[Reviews] User chose not-ready ticket=${pending.id} user=${interaction.user.id}`);
    return;
  }

  if (action === "review_submit") {
    // Must have a stored draft
    if (!pending.review_draft_text || pending.review_draft_text.trim().length === 0) {
      return interaction.reply({
        content: "I do not have a draft to submit. Please send your review again (200 characters maximum).",
        flags: MessageFlags.Ephemeral,
      });
    }

    const finalText = pending.review_draft_text.trim();

    // Finalize in DB
    finalizeReview(pending.id, finalText);

    console.log(`[Reviews] Submitting review ticket=${pending.id} user=${interaction.user.id}`);
    console.log(`[Reviews] RATING_LOG_CHANNEL_ID=${RATING_LOG_CHANNEL_ID || "(missing)"}`);

    // Log to rating channel (with explicit error logs)
    if (RATING_LOG_CHANNEL_ID) {
      try {
        const logChannel = await interaction.client.channels.fetch(RATING_LOG_CHANNEL_ID);
        if (logChannel && logChannel.isTextBased()) {
          const nowIso = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");

          const closerId = pending.moderator_id || "Unknown";
          const closerUser = pending.moderator_id
            ? await interaction.client.users.fetch(pending.moderator_id).catch(() => null)
            : null;

          const closerName = closerUser
            ? `${closerUser.username}${closerUser.discriminator ? `#${closerUser.discriminator}` : ""}`
            : closerId;

          const userTag = `${interaction.user.username}${
            interaction.user.discriminator ? `#${interaction.user.discriminator}` : ""
          }`;

          const block = [
            "```text",
            `Time: ${nowIso}`,
            `User: ${interaction.user.username} (${userTag}) [${interaction.user.id}]`,
            `Closed By: ${closerName} [${closerId}]`,
            "",
            "Review:",
            finalText,
            "```",
          ].join("\n");

          await logChannel.send({ content: block });
          console.log(`[Reviews] Rating log sent OK ticket=${pending.id}`);
        } else {
          console.log(`[Reviews] Rating log channel not text-based ticket=${pending.id}`);
        }
      } catch (err) {
        console.error("[Reviews] Failed to send rating log:", err);
      }
    }

    await interaction.reply({
      content: "Thank you. Your feedback has been recorded.",
      flags: MessageFlags.Ephemeral,
    });

    return;
  }
}
