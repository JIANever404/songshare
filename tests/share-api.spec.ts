import { expect, test } from "@playwright/test";

function buildGamesPayload() {
  return [
    {
      id: "song-101",
      name: "周杰伦",
      localizedName: "稻香",
      cover: "https://example.com/cover-1.jpg",
      releaseYear: 2008,
    },
    {
      id: "song-102",
      entryId: "chosen-second",
      name: "陈奕迅",
      localizedName: "富士山下",
      cover: "https://example.com/cover-2.jpg",
      releaseYear: 2006,
    },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ];
}

test("share api 会为条目补 entryId 并持久化 coverOrder", async ({ request }) => {
  const createResponse = await request.post("/api/share", {
    data: {
      kind: "song",
      creatorName: "接口测试",
      shareMessage: "检查 entryId 和 coverOrder",
      games: buildGamesPayload(),
      coverOrder: ["chosen-second"],
    },
  });

  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()) as {
    ok: boolean;
    shareId: string;
  };
  expect(created.ok).toBeTruthy();
  expect(created.shareId).toBeTruthy();

  const fetchResponse = await request.get(`/api/share?id=${created.shareId}`);
  expect(fetchResponse.ok()).toBeTruthy();
  const fetched = (await fetchResponse.json()) as {
    ok: boolean;
    games: Array<{
      id: string;
      entryId?: string;
      localizedName?: string;
    } | null>;
    coverOrder: string[];
  };

  expect(fetched.ok).toBeTruthy();
  const selectedGames = fetched.games.filter(
    (game): game is NonNullable<(typeof fetched.games)[number]> => Boolean(game)
  );
  expect(selectedGames).toHaveLength(2);
  expect(selectedGames[0]?.entryId).toBeTruthy();
  expect(selectedGames[1]?.entryId).toBe("chosen-second");
  expect(fetched.coverOrder).toHaveLength(2);
  expect(fetched.coverOrder[0]).toBe("chosen-second");
  expect(fetched.coverOrder[1]).toBe(selectedGames[0]?.entryId);
});
