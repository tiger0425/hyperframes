/**
 * frames-data.mjs — collage-smoke 长期回归样例的逐帧作者数据。
 *
 * 4 帧 = 四种句式：hook（叙事拍）/ 机制（信息屏）/ 数据（信息屏）/ 收尾。
 * 只提供「属于这一帧自己的东西」：CSS + markup + timeline；字体块 / 泄漏守卫 /
 * 四函数运行时 / reveal pass / 四层时长结构由 `tools/gen-frames.mjs` 注入。
 *
 * 入场语法一律用契约四函数 `assemble / reveal / focus / closer`（issues/10·11·22）；
 * 时间点一律用 `at('<线索>')`，线索真值在 `tools/cue-times.json`（fixture 手写）。
 */

export const TITLE = "VOX 拼贴 smoke";
export const CHANNEL_TAG = "VOX · SMOKE";

const MONO = `font-family: "JetBrains Mono", ui-monospace, monospace;`;
const HAND = `font-family: "Caveat", "Noto Sans SC", cursive; font-weight: 700; color: var(--signal);`;

/* ───────────────────────── 01 · hook（叙事拍） ───────────────────────── */

const f01 = {
  nn: "01",
  slug: "hook",
  css: `
    #f01-focus { position: absolute; left: 160px; top: 170px; width: 1400px; height: 700px; font-size: 18px; }
    #f01-card { position: absolute; inset: 0; background: var(--paper-deep); border: 3px solid var(--ink); }
    #f01-kicker { position: absolute; left: 60px; top: 44px; ${MONO} font-size: 26px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-soft); }
    #f01-line1 { position: absolute; left: 56px; top: 128px; width: 1300px; font-weight: 900; font-size: 118px; line-height: 1.04; letter-spacing: -0.02em; color: var(--ink); }
    #f01-cut { position: absolute; left: 56px; top: 300px; background: var(--signal); color: var(--paper); font-weight: 900; font-size: 84px; letter-spacing: -0.01em; padding: 8px 22px; }
    #f01-note { position: absolute; left: 60px; top: 500px; ${HAND} font-size: 46px; }
    #f01-foot { position: absolute; left: 60px; bottom: 40px; ${MONO} font-size: 22px; letter-spacing: 0.12em; color: var(--ink-soft); }
    #f01-stamp { position: absolute; right: 110px; bottom: 110px; width: 160px; height: 160px; display: flex; align-items: center; justify-content: center; border: 6px solid var(--signal); color: var(--signal); font-weight: 900; font-size: 52px; transform: rotate(-12deg); }
  `,
  body: `      <div id="f01-focus" data-focus style="width:1400px;height:700px">
        <div id="f01-card">
          <div id="f01-kicker">新模型</div>
          <div id="f01-line1">它不生成正文</div>
          <div id="f01-cut">它先想，再写</div>
          <div id="f01-note">别拿它当聊天框</div>
          <div id="f01-foot">叙事拍 · 钩子</div>
        </div>
      </div>
      <div id="f01-stamp" class="js-hide">钩子</div>`,
  script: `      assemble("#f01-line1", at("line1"), {});
      assemble("#f01-cut", at("cut"), {});
      assemble("#f01-note", at("note"), {});
      assemble("#f01-foot", at("foot"), {});
      reveal("#f01-kicker", at("kicker"), { from: { opacity: 0, y: 0 } });
      closer("#f01-stamp", at("close"), { gesture: "stamp" });`,
};

/* ───────────────────────── 02 · 机制（信息屏） ───────────────────────── */

const f02 = {
  nn: "02",
  slug: "mech",
  css: `
    #f02-focus { position: absolute; left: 160px; top: 170px; width: 1440px; height: 700px; font-size: 18px; }
    #f02-card { position: absolute; inset: 0; background: var(--paper-deep); border: 3px solid var(--ink); }
    #f02-t { position: absolute; left: 60px; top: 44px; font-weight: 900; font-size: 76px; letter-spacing: -0.02em; color: var(--ink); }
    #f02-tag { position: absolute; left: 60px; top: 184px; ${MONO} font-size: 22px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-soft); }
    #f02-c1 { position: absolute; left: 60px; top: 248px; width: 440px; height: 260px; background: var(--paper); border: 3px solid var(--ink); padding: 28px; }
    #f02-c2 { position: absolute; left: 540px; top: 248px; width: 440px; height: 260px; background: var(--paper); border: 3px solid var(--ink); padding: 28px; }
    #f02-c3 { position: absolute; left: 1020px; top: 248px; width: 440px; height: 260px; background: var(--paper); border: 3px solid var(--ink); padding: 28px; }
    #f02-c1 .n, #f02-c2 .n, #f02-c3 .n { ${MONO} font-size: 26px; letter-spacing: 0.1em; color: var(--signal); }
    #f02-c1 .d, #f02-c2 .d, #f02-c3 .d { margin-top: 16px; font-size: 34px; line-height: 1.35; color: var(--ink); }
    #f02-foot { position: absolute; left: 60px; bottom: 40px; ${MONO} font-size: 22px; letter-spacing: 0.12em; color: var(--ink-soft); }
    #f02-stamp { position: absolute; right: 110px; bottom: 110px; width: 160px; height: 160px; display: flex; align-items: center; justify-content: center; border: 6px solid var(--signal); color: var(--signal); font-weight: 900; font-size: 52px; transform: rotate(10deg); }
  `,
  body: `      <div id="f02-focus" data-focus style="width:1440px;height:700px">
        <div id="f02-card">
          <div id="f02-t">它怎么先想</div>
          <div id="f02-tag" class="js-hide">机制 · 三步</div>
          <div id="f02-c1"><div class="n">01</div><div class="d">读题目，拆成小块</div></div>
          <div id="f02-c2"><div class="n">02</div><div class="d">在脑内推演一遍</div></div>
          <div id="f02-c3"><div class="n">03</div><div class="d">只写被问到的部分</div></div>
          <div id="f02-foot">信息屏 · 机制</div>
        </div>
      </div>
      <div id="f02-stamp" class="js-hide">机制</div>`,
  script: `      assemble("#f02-t", at("t"), {});
      assemble("#f02-c1", at("c1"), {});
      assemble("#f02-c2", at("c2"), {});
      assemble("#f02-c3", at("c3"), {});
      assemble("#f02-foot", at("foot"), {});
      reveal("#f02-tag", at("tag"), {});
      focus("#f02-focus", at("focus"), { mode: "push", to: 1.1, out: 0.6 });
      closer("#f02-stamp", at("close"), { gesture: "stamp" });`,
};

/* ───────────────────────── 03 · 数据（信息屏） ───────────────────────── */

const f03 = {
  nn: "03",
  slug: "data",
  css: `
    #f03-focus { position: absolute; left: 160px; top: 170px; width: 1440px; height: 700px; font-size: 18px; }
    #f03-card { position: absolute; inset: 0; background: var(--paper-deep); border: 3px solid var(--ink); }
    #f03-t { position: absolute; left: 60px; top: 44px; font-weight: 900; font-size: 72px; letter-spacing: -0.02em; color: var(--ink); }
    #f03-row1 { position: absolute; left: 60px; top: 200px; width: 1320px; height: 130px; }
    #f03-row2 { position: absolute; left: 60px; top: 360px; width: 1320px; height: 130px; }
    #f03-r1l, #f03-r2l { ${MONO} font-size: 30px; color: var(--ink); }
    #f03-track1, #f03-track2 { position: absolute; left: 0; top: 56px; width: 1280px; height: 64px; background: var(--paper); border: 2px solid var(--rule); }
    #f03-fill1 { position: absolute; left: 2px; top: 2px; width: 1230px; height: 56px; background: var(--ink); }
    #f03-fill2 { position: absolute; left: 2px; top: 2px; width: 16px; height: 56px; background: var(--signal); }
    #f03-key { position: absolute; left: 1130px; top: 352px; border: 4px solid var(--signal); padding: 6px 14px; ${MONO} font-size: 26px; color: var(--signal); }
    #f03-cap { position: absolute; left: 60px; top: 520px; font-size: 30px; color: var(--ink-soft); }
    #f03-foot { position: absolute; left: 60px; bottom: 40px; ${MONO} font-size: 22px; letter-spacing: 0.12em; color: var(--ink-soft); }
    #f03-stamp { position: absolute; right: 110px; bottom: 110px; width: 160px; height: 160px; display: flex; align-items: center; justify-content: center; border: 6px solid var(--signal); color: var(--signal); font-weight: 900; font-size: 52px; transform: rotate(-8deg); }
  `,
  body: `      <div id="f03-focus" data-focus style="width:1440px;height:700px">
        <div id="f03-card">
          <div id="f03-t">快多少</div>
          <div id="f03-row1"><div id="f03-r1l">旧路 8.6s</div><div id="f03-track1"><div id="f03-fill1"></div></div></div>
          <div id="f03-row2"><div id="f03-r2l">新路 114ms</div><div id="f03-track2"><div id="f03-fill2"></div></div></div>
          <div id="f03-key" class="js-hide">75×</div>
          <div id="f03-cap" class="js-hide">同一件事，快了整整 75 倍</div>
          <div id="f03-foot">信息屏 · 数据</div>
        </div>
      </div>
      <div id="f03-stamp" class="js-hide">快</div>`,
  script: `      assemble("#f03-t", at("t"), {});
      assemble("#f03-row1", at("b1"), {});
      assemble("#f03-row2", at("b2"), {});
      assemble("#f03-key", at("key"), {});
      assemble("#f03-foot", at("foot"), {});
      reveal("#f03-cap", at("cap"), {});
      closer("#f03-stamp", at("close"), { gesture: "stamp" });`,
};

/* ───────────────────────── 04 · 收尾 ───────────────────────── */

const f04 = {
  nn: "04",
  slug: "close",
  css: `
    #f04-focus { position: absolute; left: 160px; top: 170px; width: 1440px; height: 700px; font-size: 18px; }
    #f04-card { position: absolute; inset: 0; background: var(--paper-deep); border: 3px solid var(--ink); }
    #f04-kicker { position: absolute; left: 60px; top: 44px; ${MONO} font-size: 26px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-soft); }
    #f04-t { position: absolute; left: 56px; top: 104px; width: 1320px; font-weight: 900; font-size: 96px; line-height: 1.06; letter-spacing: -0.02em; color: var(--ink); }
    #f04-l1 { position: absolute; left: 60px; top: 290px; font-size: 40px; color: var(--ink); }
    #f04-l2 { position: absolute; left: 60px; top: 380px; font-size: 40px; color: var(--ink); }
    #f04-note { position: absolute; left: 60px; top: 500px; ${HAND} font-size: 50px; }
    #f04-foot { position: absolute; left: 60px; bottom: 40px; ${MONO} font-size: 22px; letter-spacing: 0.12em; color: var(--ink-soft); }
    #f04-stamp { position: absolute; right: 110px; bottom: 110px; width: 180px; height: 180px; display: flex; align-items: center; justify-content: center; border: 7px solid var(--signal); color: var(--signal); font-weight: 900; font-size: 64px; transform: rotate(-14deg); }
  `,
  body: `      <div id="f04-focus" data-focus style="width:1440px;height:700px">
        <div id="f04-card">
          <div id="f04-kicker" class="js-hide">收尾</div>
          <div id="f04-t">现在就够用了</div>
          <div id="f04-l1">先拿一件小事试</div>
          <div id="f04-l2">再决定要不要换</div>
          <div id="f04-note">从今天开始</div>
          <div id="f04-foot">闭合主张 · 收尾</div>
        </div>
      </div>
      <div id="f04-stamp" class="js-hide">开工</div>`,
  script: `      assemble("#f04-t", at("t"), {});
      assemble("#f04-l1", at("l1"), {});
      assemble("#f04-l2", at("l2"), {});
      assemble("#f04-note", at("note"), {});
      assemble("#f04-foot", at("foot"), {});
      reveal("#f04-kicker", at("kicker"), {});
      closer("#f04-stamp", at("close"), { gesture: "stamp" });`,
};

export const FRAMES = [f01, f02, f03, f04];
