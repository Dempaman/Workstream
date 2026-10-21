import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const output = resolve("test-results");
await mkdir(output, { recursive: true });
const data = await mkdtemp(join(output, "theme-"));
const launch = () =>
  electron.launch({
    ...(process.env.WORKSTREAM_TEST_EXECUTABLE
      ? {
          executablePath: resolve(process.env.WORKSTREAM_TEST_EXECUTABLE),
          args: [],
        }
      : { args: ["."] }),
    env: { ...process.env, WORKSTREAM_DATA_DIR: data, WORKSTREAM_DEV_URL: "" },
  });
let app = await launch();
const errors = [];
try {
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const theme of ["dark", "light", "dark"]) {
    await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
    await page.waitForFunction(
      (theme) =>
        document.documentElement.classList.contains("dark") ===
        (theme === "dark"),
      theme,
    );
    assert.equal(
      await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource),
      theme,
    );
    await page.screenshot({
      path: join(output, `theme-${theme}-overview.png`),
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "Connect a repository", exact: false })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({
    path: join(output, "theme-dark-dialog.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  for (const name of ["Agents & models", "Workflow", "Projects"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.screenshot({
      path: join(output, `theme-dark-${name.replaceAll(/\W/g, "-")}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(output, "theme-dark-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.equal(
    JSON.parse(await readFile(join(data, "state.json"), "utf8")).theme,
    "dark",
  );
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByRole("button", { name: "Switch to light mode" }).waitFor();
  assert.equal(
    await page.evaluate(() => window.workstream.initialTheme),
    "dark",
  );
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    "rgb(16, 23, 34)",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Theme switching, native appearance, dialogs, narrow layout, and restart persistence passed.",
  );
} finally {
  await app.close();
}
