import { expect, test } from "bun:test";
import {
  assertAuthenticatedChatGptPage,
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_EFFORT_CONTROL_SELECTOR,
  CHATGPT_LOGGED_OUT_CONTROL_SELECTOR,
  detectChatGptAccountCapabilities,
} from "../src/chatgpt-session";

function fakeVisibilityLocator(visibleElements: number) {
  return {
    count: async () => visibleElements,
    nth: () => ({ isVisible: async () => true }),
  };
}

function fakePageWithVisibility(perSelector: Record<string, number>) {
  return {
    locator: (selector: string) => fakeVisibilityLocator(perSelector[selector] ?? 0),
  };
}

test("an anonymous Temporary Chat with a composer is rejected as unauthenticated", async () => {
  // The logged-out chatgpt.com surface renders a usable composer, so the
  // assertion must reject the page while Log in/Sign up controls are visible.
  const page = fakePageWithVisibility({
    [CHATGPT_LOGGED_OUT_CONTROL_SELECTOR]: 2,
    [CHATGPT_COMPOSER_SELECTOR]: 1,
  });
  await expect(assertAuthenticatedChatGptPage(page as never))
    .rejects.toThrow("logged-out Log in/Sign up controls");
});

test("an authenticated composer without logged-out controls passes verification", async () => {
  const page = fakePageWithVisibility({ [CHATGPT_COMPOSER_SELECTOR]: 1 });
  await expect(assertAuthenticatedChatGptPage(page as never)).resolves.toBeUndefined();
});

test("a page with neither composer nor logged-out controls is rejected", async () => {
  const page = fakePageWithVisibility({});
  await expect(assertAuthenticatedChatGptPage(page as never))
    .rejects.toThrow("no visible composer");
});

test("the effort selector identifies the model slider instead of any composer menu button", () => {
  expect(CHATGPT_EFFORT_CONTROL_SELECTOR).toContain('[data-animated-slider-trigger="true"]');
  expect(CHATGPT_EFFORT_CONTROL_SELECTOR).toContain('[data-testid="model-switcher-dropdown-button"]');
  expect(CHATGPT_EFFORT_CONTROL_SELECTOR).not.toBe('button[aria-haspopup="menu"]');
});

test("a complete authenticated composer with no effort selector is Luna-only", async () => {
  const effortButton = {
    last() { return this; },
    isVisible: async () => false,
  };
  const composerForm = {
    count: async () => 1,
    locator: () => effortButton,
  };
  const composer = {
    filter() { return this; },
    last() { return this; },
    count: async () => 1,
    isVisible: async () => true,
    locator: () => composerForm,
  };
  const page = {
    locator: () => composer,
    evaluate: async () => true,
  };

  await expect(detectChatGptAccountCapabilities(page as never, {
    selectorTimeoutMs: 100,
    stableAbsenceMs: 0,
  })).resolves.toEqual({ solAvailable: false, proAvailable: false });
});

test("a transient effort control does not turn a Luna-only account into Sol", async () => {
  let visibilityReads = 0;
  const effortButton = {
    last() { return this; },
    isVisible: async () => {
      visibilityReads += 1;
      return visibilityReads === 1;
    },
  };
  const composerForm = {
    count: async () => 1,
    locator: () => effortButton,
  };
  const composers = {
    filter() { return this; },
    last() { return this; },
    count: async () => 1,
    locator: () => composerForm,
  };
  const page = {
    locator: () => composers,
    evaluate: async () => true,
  };

  await expect(detectChatGptAccountCapabilities(page as never, {
    selectorTimeoutMs: 100,
    stableAbsenceMs: 0,
  })).resolves.toEqual({ solAvailable: false, proAvailable: false });
  expect(visibilityReads).toBe(2);
});
