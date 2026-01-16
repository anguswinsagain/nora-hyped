import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";

import { logTicketCreation, logTicketResolution } from "./db.js";

const CATEGORIES = [
  { id: "player_card", label: "Report a Player or Card", emoji: "🚩" },
  { id: "staff_abuse", label: "Report Staff Abuse", emoji: "⚠️" },
  { id: "appeal", label: "Appeal Moderation Action", emoji: "📨" },
  { id: "general", label: "General Support", emoji: "💬" },
  { id: "data_loss", label: "Data Loss / Donation Issues", emoji: "💾" },
  { id: "bug", label: "Report a Bug", emoji: "🐛" },
];

export async function handleSupportSelectInteraction(interaction, client) {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== "support_select") return;

  const categoryId = interaction.values[0];
  const category = CATEGORIES.find((c) => c.id === categoryId);
  const guild = interaction.guild;
  const user = interaction.user;

  const staffRoleId = process.env.SUPPORT_STAFF_ROLE_ID;
  const parentCategoryId = process.env.SUPPORT_CATEGORY_ID;

  const ticketChannel = await guild.channels.create({
    name: `ticket-${categoryId}-${user.username}`.toLowerCase(),
    type: ChannelType.GuildText,
    parent: parentCategoryId || undefined,
    permissionOverwrites: [
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
        id: staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  logTicketCreation({
    channelId: ticketChannel.id,
    userId: user.id,
    category: categoryId,
  });

  await ticketChannel.send(`Ticket created: <@${user.id}> selected **${category.label}**`);
  await interaction.reply({ content: `Ticket created: ${ticketChannel}`, ephemeral: true });
}

export async function handleResolveCommand(message) {
  if (!message.content.startsWith("!resolve")) return;

  const staffRoleId = process.env.SUPPORT_STAFF_ROLE_ID;
  if (!message.member.roles.cache.has(staffRoleId)) {
    return message.reply("You don't have permission to resolve tickets.");
  }

  const summary = message.content.replace("!resolve", "").trim();

  logTicketResolution({
    channelId: message.channel.id,
    moderatorId: message.author.id,
    resolutionText: summary,
  });

  await message.channel.send("Ticket resolved. Closing in 10 seconds…");

  setTimeout(() => {
    message.channel.delete().catch(() => {});
  }, 10000);
}
