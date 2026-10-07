import assert from "node:assert/strict"
import { createRequire } from "node:module"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const require = createRequire(path.resolve(root, "../app/package.json"))
const { createServer } = require("vite")
const solid = require("vite-plugin-solid")
const { chromium } = require("@playwright/test")
const stub = `
import { ErrorBoundary, createSignal, createEffect, onMount } from 'solid-js';
export const mode = new URLSearchParams(location.search).get('mode');
export const state = window.fixture = { reports: 0, finished: 0, focus: 0 };
export const ServerConnection = { Key: { make: x => x }, builtin: () => true, key: x => x.key };
export const currentRoute = () => ({type:'home'});
export const useCurrentRoute = () => currentRoute;
export const preloadRoute = async () => {};
export const PlatformProvider = p => p.children;
export function AppBaseProviders(p) { onMount(() => p.onThemeApplied('light','system')); return <ErrorBoundary fallback={<div id="recovery">Recovery</div>}>{p.children}</ErrorBoundary> }
export function AppInterface(p) {
  const [fail,setFail] = createSignal(false);
  onMount(() => { document.querySelector('textarea')?.focus(); if(mode==='render-failure')requestAnimationFrame(()=>setFail(true)); });
  return <>{p.children}<textarea aria-label="composer"/>{(() => { if(fail())throw Error('render failure'); return null })()}</>;
}
export const useLanguage = () => ({t: x=>x});
export const useExtensionServers = () => ({ ready: () => true, list: () => [] });
export const useTabs = () => ({ready:()=>true, recentReady:()=>true, infoReady:()=>true, store:[], newDraft:async()=>({}),select:()=>{} });
export const useServers = () => ({list:[],projects:{forServer:()=>({open:()=>{},touch:()=>{}})}});
export const useGlobal = () => ({});
export const useCommand = () => ({trigger: id => { if(id==='input.focus'){ state.focus++; document.querySelector('textarea')?.focus() } }});
export const useTheme = () => ({themeId:()=>'',mode:()=>''});
export const bindDesktopMenu = () => {};
export const createDesktopPlatform = () => ({});
export const preloadStoredLocale = async () => 'en';
export const LoadingSplash = () => <div>Loading</div>;
export const getLastActiveUrl = () => '/';
export const DesktopMemoryRouter = p => p.children;
export const MigrationStatus = () => null;
export const api = {
 getWindowID:()=>1,getWindowBootstrap:()=>({firstLaunchPending:true,defaultServerUrl:null}),awaitInitialization:async()=>({url:'http://127.0.0.1'}),
 finishFirstLaunchOnboarding:async()=>{state.finished++;if(mode==='onboarding-failure')throw Error('onboarding failed');return null},
 reportStartupReady:()=>{state.reports++;return new Promise(resolve=>state.accept=resolve)},
 themeReady:async()=>{},setTitlebar:async()=>{},setBackgroundColor:async()=>{},setNativeTranslations:async()=>{}
};
`
const server = await createServer({
  configFile: false,
  root,
  cacheDir: path.join(root, "node_modules/.cache/launcher-renderer"),
  optimizeDeps: { noDiscovery: true, include: ["solid-js", "solid-js/web", "solid-js/store"] },
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
  plugins: [
    {
      name: "readiness-fixtures",
      enforce: "pre",
      resolveId(id, importer) {
        if (id === "/fixture.tsx") return root + "/fixture.tsx"
        if (id === "fixture-stubs" || id === "@opencode/app/desktop" || id === "@opencode/ui/theme/context")
          return root + "/fixture-stubs.tsx"
        if (
          importer?.replaceAll("\\", "/").endsWith("/renderer/desktop-app.tsx") &&
          [
            "./platform",
            "./platform/menu",
            "./startup/locale",
            "./startup/splash",
            "./window/route-storage",
            "./window/router",
            "./migration-status",
          ].includes(id)
        )
          return root + "/fixture-stubs.tsx"
      },
      load(id) {
        if (id.replaceAll("\\", "/") === (root + "/fixture-stubs.tsx").replaceAll("\\", "/")) return stub
        if (id.replaceAll("\\", "/") === (root + "/fixture.tsx").replaceAll("\\", "/"))
          return `import {render} from 'solid-js/web';import {DesktopApp} from '/src/renderer/desktop-app.tsx';import {api} from 'fixture-stubs';render(()=> <DesktopApp api={api} version="fixture"/>,document.getElementById('root'));`
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/?")) return next()
          res.setHeader("Content-Type", "text/html")
          res.end('<div id="root"></div><script type="module" src="/fixture.tsx"></script>')
        })
      },
    },
    solid(),
  ],
})
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  for (const mode of ["onboarding-failure", "render-failure", "ready"]) {
    const page = await browser.newPage()
    page.on("pageerror", (error) => console.error(mode, error.message))
    await page.goto(server.resolvedUrls.local[0] + "?mode=" + mode)
    if (mode !== "ready") {
      await page.locator("#recovery").waitFor()
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.evaluate(() => window.fixture.reports), 0, mode)
    } else {
      await page.waitForFunction(() => window.fixture?.reports === 1)
      assert.equal(await page.locator("textarea").evaluate((el) => el.closest("[inert]") !== null), true)
      await page.evaluate(() => window.fixture.accept())
      await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA")
      assert.equal(await page.locator("textarea").evaluate((el) => el.closest("[inert]") !== null), false)
    }
    console.log("PASS renderer " + mode)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
