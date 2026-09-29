/** The same native browser scenario runs through Playwright and WebDriver Classic. */
async function checkNativeSurfaces(): Promise<string[]> {
  const provider = text(document, '#provider');
  const pageCount = chrome.extension.getViews({ type: 'tab' }).length;
  await chrome.runtime.openOptionsPage();
  assert(
    chrome.extension.getViews({ type: 'tab' }).length === pageCount,
    'Options should reuse an existing page',
  );
  assert(chrome.extension.getViews({ type: 'popup' }).length === 0, 'Popup must start closed');
  const popup = await openPopup();
  const caller = await checkLivePopup(popup, provider);
  popup.close();
  await popupClosed();
  assert(text(document, '#provider') === provider, 'Closing popup must retain provider');
  click(document, '#release');
  await waitFor('pending action release', () => text(document, '#result') !== 'Pending');
  await executions(2, 2);
  const replacement = await openPopup();
  await checkReopenedPopup(replacement, provider, caller);
  replacement.close();
  await popupClosed();
  return [
    'native options opening reuses the existing page',
    'real native popup has a usable width and renders the shared JSON view',
    'popup action updates the surviving options page exactly once',
    'catalog disable/enable reaches both native surfaces',
    'popup close destroys its window and pending action completes without replay',
    'reopened popup has a new caller, reset local form and retained native provider state',
  ];
}

async function checkLivePopup(popup: Window, provider: string): Promise<string> {
  const optionsForm = input(document).value;
  assert(popup.innerWidth >= 360, 'Popup should have usable width');
  assert(
    popup.document.documentElement.scrollWidth <= popup.innerWidth,
    'Popup should not scroll horizontally',
  );
  assert(
    text(popup.document, '#provider') === provider,
    'Popup must use the live background provider',
  );
  const caller = await callerIdentity(popup.document);
  input(popup.document).value = 'popup-only';
  assert(input(document).value === optionsForm, 'Form state must remain local');
  increase(popup.document);
  await counter(document, 17);
  await counter(popup.document, 17);
  click(document, '#disable-service');
  await catalog(popup, 'disabled');
  click(popup.document, '#routed');
  await waitFor('unavailable routed action', () =>
    text(popup.document, '#result').includes('No currently available provider'),
  );
  click(document, '#enable-service');
  await catalog(popup, 'active');
  click(popup.document, '#wait');
  await waitFor('pending popup action', () => text(popup.document, '#result') === 'Pending');
  await executions(2, 1);
  return caller;
}

async function checkReopenedPopup(popup: Window, provider: string, caller: string): Promise<void> {
  assert(text(popup.document, '#provider') === provider, 'Reopened popup must retain provider');
  assert(input(popup.document).value === '', 'Reopened popup must reset local form');
  assert(
    text(popup.document, '#result') === '',
    'Reopened popup must not receive the old action result',
  );
  await counter(popup.document, 17);
  assert(
    (await callerIdentity(popup.document)) !== caller,
    'Reopened popup must have a fresh connection',
  );
  increase(popup.document);
  await counter(document, 18);
  await counter(popup.document, 18);
  await executions(2, 2);
}

async function openPopup(): Promise<Window> {
  await chrome.action.openPopup();
  await waitFor('native popup connection', () => {
    const views = chrome.extension.getViews({ type: 'popup' });
    return (
      views.length === 1 && views[0]?.document.querySelector('#status')?.textContent === 'Connected'
    );
  });
  const view = chrome.extension.getViews({ type: 'popup' })[0];
  assert(view !== undefined, 'Expected one native popup');
  return view;
}

async function popupClosed(): Promise<void> {
  await waitFor('popup closes', () => chrome.extension.getViews({ type: 'popup' }).length === 0);
}

async function callerIdentity(page: Document): Promise<string> {
  click(page, '#identity');
  await waitFor('popup caller identity', () => text(page, '#result').includes('panel.html'));
  return text(page, '#result');
}

async function catalog(popup: Window, status: string): Promise<void> {
  await waitFor(`catalog ${status}`, () =>
    [document, popup.document].every((page) => text(page, '#catalog') === status),
  );
}

async function executions(started: number, completed: number): Promise<void> {
  click(document, '#executions');
  await waitFor(
    'execution counts',
    () => text(document, '#result') === JSON.stringify({ started, completed }),
  );
}

async function counter(page: Document, value: number): Promise<void> {
  await waitFor(`counter ${value}`, () => {
    const rendered = page
      .querySelector('#renderer')
      ?.shadowRoot?.querySelector('.devframes-json-render-scroll-root')?.textContent;
    return rendered?.match(/Counter:\s*(\d+)/u)?.[1] === String(value);
  });
}

function increase(page: Document): void {
  const button = page.querySelector('#renderer')?.shadowRoot?.querySelector('button');
  assert(button !== undefined && button !== null, 'Expected the native JSON button');
  button.click();
}

function click(page: Document, selector: string): void {
  const element = page.querySelector<HTMLElement>(selector);
  assert(element !== null, `Missing ${selector}`);
  element.click();
}

function text(page: Document, selector: string): string {
  return page.querySelector(selector)?.textContent ?? '';
}

function input(page: Document): HTMLInputElement {
  const element = page.querySelector<HTMLInputElement>('#server-id');
  assert(element !== null, 'Expected local form input');
  return element;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor(description: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error(`Timed out waiting for ${description}`);
}

/** Serialize the browser-only functions without adding hooks to the shipped application. */
export const nativeSurfaceScript = [
  checkNativeSurfaces,
  checkLivePopup,
  checkReopenedPopup,
  openPopup,
  popupClosed,
  callerIdentity,
  catalog,
  executions,
  counter,
  increase,
  click,
  text,
  input,
  assert,
  waitFor,
]
  .map((operation) => operation.toString())
  .join('\n');
