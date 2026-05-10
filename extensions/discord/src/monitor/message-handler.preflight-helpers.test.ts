import { beforeAll, describe, expect, it } from "vitest";

const BASE_MENTION_PARAMS = {
  botId: "bot-123",
  hasAnyMention: false,
  isDirectMessage: false,
  isExplicitlyMentioned: false,
  mentionRegexes: [] as RegExp[],
  mentionText: "",
  mentionedEveryone: false,
  senderIsPluralKit: false,
} as const;

describe("resolveDiscordMentionState", () => {
  let resolveDiscordMentionState: typeof import("./message-handler.preflight-helpers.js").resolveDiscordMentionState;

  beforeAll(async () => {
    ({ resolveDiscordMentionState } = await import("./message-handler.preflight-helpers.js"));
  });

  it("grants reply_to_bot implicit mention when a human replies to the bot's message", () => {
    const result = resolveDiscordMentionState({
      ...BASE_MENTION_PARAMS,
      authorIsBot: false,
      referencedAuthorId: "bot-123",
    });

    expect(result.implicitMentionKinds).toContain("reply_to_bot");
  });

  it("suppresses reply_to_bot implicit mention when a bot replies to the bot's message", () => {
    const result = resolveDiscordMentionState({
      ...BASE_MENTION_PARAMS,
      authorIsBot: true,
      referencedAuthorId: "bot-123",
    });

    expect(result.implicitMentionKinds).not.toContain("reply_to_bot");
  });

  it("does not grant reply_to_bot when referencedAuthorId is a different bot", () => {
    const result = resolveDiscordMentionState({
      ...BASE_MENTION_PARAMS,
      authorIsBot: false,
      referencedAuthorId: "other-bot-456",
    });

    expect(result.implicitMentionKinds).not.toContain("reply_to_bot");
  });

  it("does not grant reply_to_bot when referencedAuthorId is absent", () => {
    const result = resolveDiscordMentionState({
      ...BASE_MENTION_PARAMS,
      authorIsBot: false,
      referencedAuthorId: undefined,
    });

    expect(result.implicitMentionKinds).not.toContain("reply_to_bot");
  });
});
