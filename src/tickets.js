import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";

import {
  logTicketCreation,
  logTicketResolution,
} from "./db.js";

const CATEGORIES = [
  { id: "player_card", label: "Report a Player or Card", emoji: "🚩" },
  { id: "staff_abuse", label: "Report Staff Abuse", emoji: "⚠️" },
  { id: "appeal", label: "Appeal Moderation Action", emoji: "📨" },
  { id: "general", label: "General Support", emoji: "💬" },
  { id: "data_loss", label: "Data Loss / Donations / Player Data", emoji: "💾" },
  { id: "bug", label: "Report a Bug", emoji: "🐛" },
];

export function buildSupportPanelRow() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("support_select")
    .setPlaceholder("Choose a support category…")
    .addOptions(
      CATEGORIES.map((c) => ({
        label: c.label,
        value: c.id,
        emoji: c.emoji,
      }))
    );

  return new ActionRowBuilder().addComponents(select);
}

export async function sendSupportPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle("📨 HYPED Support Portal")
    .setDescription(
      [
        "Need help? Choose a category below to open a private ticket with staff.",
        "",
        "🚩 **Report a Player or Card**",
        "⚠️ **Report Staff Abuse**",
        "📨 **Appeal Moderation Action**",
        "",
        "💬 **General Support / Questions**",
        "💾 **Data Loss / Donations / Player Data**",
        "🐛 **Report a Bug**",
      ].join("\n")
    )
    .setColor(0x5865f2);

  await channel.send({
    embeds: [embed],
    components: [buildSupportPanelRow()],
  });
}

export async function handleSupportSelectInteraction(interaction, client) {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== "support_select") return;

  const categoryId = interaction.values[0];
  const category = CATEGORIES.find((c) => c.id === categoryId);
  if (!category) return;

  const guild = interaction.guild;
  const user = interaction.user;

  const staffRoleId = process.env.SUPPORT_STAFF_ROLE_ID;
  const parentCategoryId = process.env.SUPPORT_CATEGORY_ID;

  if (!guild) {
    return interaction.reply({
      content: "Tickets can only be created in a server.",
      ephemeral: true,
    });
  }

  const channelName = `ticket-${categoryId}-${user.username}`
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .slice(0, 90);

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

  logTicketCreation({
    channelId: ticketChannel.id,
    userId: user.id,
    category: categoryId,
  });

  await ticketChannel.send(
    [
      `Ticket created for <@${user.id}> — **${category.label}**`,
      "",
      "A staff member will respond as soon as possible.",
      "",
      "When resolved, a moderator can close this ticket with:",
      "`!resolve your summary here`",
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
    return message.reply("You don't have permission to resolve tickets.");
  }

  const summary = message.content.replace("!resolve", "").trim();

  logTicketResolution({
    channelId: message.channel.id,
    moderatorId: message.author.id,
    resolutionText: summary || null,
  });

  await message.channel.send(
    "✅ Ticket resolved. This channel will be deleted in 10 seconds…"
  );

  setTimeout(() => {
    message.channel.delete().catch(() => {});
  }, 10_000);
}
