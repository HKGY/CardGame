window.CG = window.CG || {};

/* ===========================================================================
 *  角色贴图 —— 内联 SVG 的简易“图形贴图”，自包含、无需图片资源。
 *  敌人数据里的 sprite 字段对应这里的 key；找不到就用 blob 兜底。
 *  统一 viewBox：0 0 120 140。
 * ===========================================================================
 */
(function (CG) {
  const S = {
    // 玩家：蓝甲骑士（面朝右）
    knight: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="34" ry="8" fill="#0003"/>
      <rect x="22" y="48" width="6" height="52" rx="3" fill="#dfe6f0"/>
      <rect x="18" y="92" width="16" height="6" rx="3" fill="#8a6b2a"/>
      <rect x="38" y="60" width="44" height="56" rx="14" fill="#3a6ea5"/>
      <rect x="46" y="112" width="12" height="22" rx="5" fill="#2a4d70"/>
      <rect x="62" y="112" width="12" height="22" rx="5" fill="#2a4d70"/>
      <rect x="40" y="20" width="40" height="46" rx="16" fill="#7aa7d6"/>
      <rect x="46" y="40" width="30" height="8" rx="4" fill="#1a2433"/>
      <rect x="58" y="10" width="4" height="12" fill="#f0c040"/><circle cx="60" cy="8" r="5" fill="#f0c040"/>
      <path d="M84 66 q16 4 16 20 q0 18 -16 24 q-16 -6 -16 -24 q0 -16 16 -20z" fill="#c9d6e8" stroke="#2a3b52" stroke-width="2"/>
      <circle cx="84" cy="86" r="5" fill="#f0c040"/>
    </svg>`,

    // 颚虫
    worm: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="38" ry="8" fill="#0003"/>
      <ellipse cx="60" cy="98" rx="42" ry="30" fill="#5a8f3f"/>
      <ellipse cx="60" cy="74" rx="36" ry="26" fill="#6aa84f"/>
      <ellipse cx="60" cy="50" rx="29" ry="22" fill="#84bb63"/>
      <path d="M38 54 q22 30 44 0 q-22 12 -44 0z" fill="#3a2222"/>
      <polygon points="43,54 47,66 51,54" fill="#fff"/><polygon points="56,57 60,70 64,57" fill="#fff"/><polygon points="69,54 73,66 77,54" fill="#fff"/>
      <circle cx="49" cy="40" r="7" fill="#fff"/><circle cx="50" cy="41" r="3.5" fill="#111"/>
      <circle cx="71" cy="40" r="7" fill="#fff"/><circle cx="70" cy="41" r="3.5" fill="#111"/>
    </svg>`,

    // 邪教徒
    cultist: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="32" ry="8" fill="#0003"/>
      <path d="M60 30 L94 126 L26 126 Z" fill="#5b3a8c"/>
      <path d="M60 14 q28 6 28 44 q-28 -16 -56 0 q0 -38 28 -44z" fill="#43286a"/>
      <ellipse cx="60" cy="54" rx="15" ry="17" fill="#170e22"/>
      <circle cx="54" cy="54" r="3.2" fill="#ff5a5a"/><circle cx="66" cy="54" r="3.2" fill="#ff5a5a"/>
      <rect x="38" y="88" width="44" height="9" rx="4" fill="#6b4aa0"/><circle cx="60" cy="92" r="7" fill="#f0c040"/>
    </svg>`,

    // 尖刺史莱姆（橙）
    spike: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="32" ry="8" fill="#0003"/>
      <polygon points="40,64 46,40 52,64" fill="#c96a1e"/>
      <polygon points="54,58 60,30 66,58" fill="#c96a1e"/>
      <polygon points="68,64 74,40 80,64" fill="#c96a1e"/>
      <path d="M28 104 q0 -48 32 -48 q32 0 32 48 q-32 14 -64 0z" fill="#e08a3c"/>
      <circle cx="50" cy="86" r="6" fill="#fff"/><circle cx="51" cy="87" r="3" fill="#111"/>
      <circle cx="70" cy="86" r="6" fill="#fff"/><circle cx="69" cy="87" r="3" fill="#111"/>
      <path d="M50 100 q10 8 20 0" stroke="#5a2f12" stroke-width="3" fill="none"/>
    </svg>`,

    // 格雷姆林头领（红，凶）
    nob: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="38" ry="8" fill="#0003"/>
      <polygon points="34,44 26,22 46,38" fill="#7a1f1f"/><polygon points="86,44 94,22 74,38" fill="#7a1f1f"/>
      <path d="M26 96 q0 -56 34 -56 q34 0 34 56 q-34 16 -68 0z" fill="#b23b3b"/>
      <rect x="40" y="110" width="14" height="22" rx="5" fill="#7a2626"/><rect x="66" y="110" width="14" height="22" rx="5" fill="#7a2626"/>
      <path d="M40 64 l16 6 M80 64 l-16 6" stroke="#3a1010" stroke-width="4"/>
      <circle cx="49" cy="74" r="6" fill="#ffcf3a"/><circle cx="71" cy="74" r="6" fill="#ffcf3a"/>
      <circle cx="49" cy="74" r="2.5" fill="#111"/><circle cx="71" cy="74" r="2.5" fill="#111"/>
      <path d="M44 92 q16 12 32 0 l-6 -4 -6 4 -8 -4 -6 4z" fill="#fff"/>
    </svg>`,

    // 哨卫（几何炮塔）
    sentry: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="30" ry="7" fill="#0003"/>
      <polygon points="60,22 96,70 60,118 24,70" fill="#3b4a63" stroke="#2a3850" stroke-width="2"/>
      <polygon points="60,40 82,70 60,100 38,70" fill="#26324a"/>
      <circle cx="60" cy="70" r="13" fill="#0c1320"/>
      <circle cx="60" cy="70" r="7" fill="#ff7a4a"/><circle cx="60" cy="70" r="3" fill="#fff2cc"/>
    </svg>`,

    // 守卫者（机械方块首领）
    guardian: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="134" rx="42" ry="8" fill="#0003"/>
      <rect x="22" y="40" width="76" height="80" rx="8" fill="#4a5570" stroke="#2c3450" stroke-width="3"/>
      <rect x="10" y="58" width="14" height="40" rx="4" fill="#3a4360"/><rect x="96" y="58" width="14" height="40" rx="4" fill="#3a4360"/>
      <rect x="34" y="56" width="52" height="20" rx="4" fill="#0c1320"/>
      <circle cx="48" cy="66" r="6" fill="#ff5a4e"/><circle cx="72" cy="66" r="6" fill="#ff5a4e"/>
      <path d="M36 92 h48 M36 100 h48" stroke="#2c3450" stroke-width="4"/>
      <rect x="44" y="104" width="32" height="10" rx="3" fill="#f0c040"/>
    </svg>`,

    // 史莱姆之王（巨型绿史莱姆首领）
    slimeboss: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="134" rx="46" ry="9" fill="#0003"/>
      <path d="M16 110 q-2 -78 44 -78 q46 0 44 78 q-44 18 -88 0z" fill="#3f9b54" opacity="0.95"/>
      <path d="M30 60 q30 -16 60 0" stroke="#9be8ad" stroke-width="3" fill="none" opacity="0.6"/>
      <circle cx="46" cy="84" r="9" fill="#fff"/><circle cx="48" cy="86" r="4.5" fill="#111"/>
      <circle cx="76" cy="84" r="9" fill="#fff"/><circle cx="74" cy="86" r="4.5" fill="#111"/>
      <path d="M44 104 q16 14 34 0 q-17 4 -34 0z" fill="#173e22"/>
    </svg>`,

    // 绿史莱姆
    greenslime: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="34" ry="8" fill="#0003"/>
      <path d="M26 106 q0 -52 34 -52 q34 0 34 52 q-34 16 -68 0z" fill="#4fae5a" opacity="0.95"/>
      <path d="M34 66 q26 -14 52 0" stroke="#a7e8ad" stroke-width="3" fill="none" opacity="0.6"/>
      <circle cx="50" cy="88" r="6" fill="#fff"/><circle cx="51" cy="89" r="3" fill="#111"/>
      <circle cx="70" cy="88" r="6" fill="#fff"/><circle cx="69" cy="89" r="3" fill="#111"/>
    </svg>`,

    // 蝙蝠群
    bat: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="128" rx="30" ry="7" fill="#0003"/>
      <path d="M60 64 q-34 -22 -50 -6 q14 -2 16 8 q-12 4 -8 16 q16 -16 42 0z" fill="#3a2f4a"/>
      <path d="M60 64 q34 -22 50 -6 q-14 -2 -16 8 q12 4 8 16 q-16 -16 -42 0z" fill="#3a2f4a"/>
      <ellipse cx="60" cy="72" rx="16" ry="18" fill="#4a3d5e"/>
      <polygon points="50,56 54,46 58,56" fill="#4a3d5e"/><polygon points="62,56 66,46 70,56" fill="#4a3d5e"/>
      <circle cx="54" cy="70" r="3" fill="#ffcf3a"/><circle cx="66" cy="70" r="3" fill="#ffcf3a"/>
    </svg>`,

    // 霜灵
    frost: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="28" ry="7" fill="#0003"/>
      <path d="M60 38 q26 18 22 52 q-22 16 -44 0 q-4 -34 22 -52z" fill="#8fd4ec" opacity="0.92"/>
      <path d="M60 30 v22 M50 40 l20 12 M70 40 l-20 12" stroke="#dff4fb" stroke-width="3"/>
      <circle cx="52" cy="78" r="5" fill="#1a3340"/><circle cx="68" cy="78" r="5" fill="#1a3340"/>
      <path d="M50 96 q10 8 20 0" stroke="#2a5566" stroke-width="3" fill="none"/>
    </svg>`,

    // 狂战士
    berserker: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="134" rx="36" ry="8" fill="#0003"/>
      <rect x="14" y="40" width="8" height="64" rx="3" fill="#caa" transform="rotate(-18 18 72)"/>
      <rect x="6" y="34" width="22" height="14" rx="3" fill="#888" transform="rotate(-18 18 72)"/>
      <path d="M30 100 q0 -54 30 -54 q30 0 30 54 q-30 16 -60 0z" fill="#8a3b3b"/>
      <rect x="44" y="112" width="14" height="22" rx="5" fill="#5a2626"/><rect x="62" y="112" width="14" height="22" rx="5" fill="#5a2626"/>
      <path d="M40 60 l16 6 M80 60 l-16 6" stroke="#3a1010" stroke-width="4"/>
      <circle cx="49" cy="72" r="5" fill="#ffce3a"/><circle cx="71" cy="72" r="5" fill="#ffce3a"/>
      <path d="M44 90 q16 12 32 0 l-6 -4 -10 4 -10 -4z" fill="#fff"/>
    </svg>`,

    // 时之主宰
    chrono: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="134" rx="40" ry="8" fill="#0003"/>
      <path d="M60 22 L96 120 L24 120 Z" fill="#3b3566"/>
      <circle cx="60" cy="64" r="26" fill="#14101f" stroke="#7a6fb0" stroke-width="3"/>
      <line x1="60" y1="64" x2="60" y2="46" stroke="#c9b8ff" stroke-width="3"/>
      <line x1="60" y1="64" x2="74" y2="70" stroke="#c9b8ff" stroke-width="3"/>
      <circle cx="60" cy="64" r="3" fill="#ffe9a8"/>
      <circle cx="48" cy="60" r="3.5" fill="#ff8a5a"/><circle cx="72" cy="60" r="3.5" fill="#ff8a5a"/>
    </svg>`,

    // 兜底
    blob: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="32" ry="8" fill="#0003"/>
      <path d="M28 104 q0 -54 32 -54 q32 0 32 54 q-32 14 -64 0z" fill="#8a8f9e"/>
      <circle cx="50" cy="84" r="6" fill="#fff"/><circle cx="51" cy="85" r="3" fill="#111"/>
      <circle cx="70" cy="84" r="6" fill="#fff"/><circle cx="69" cy="85" r="3" fill="#111"/>
    </svg>`,
  };

  // 角色立绘：纯内联 SVG，无任何图片资源。找不到的 key 用 blob 兜底。
  function get(name) { return S[name] || S.blob; }

  CG.Sprites = { get, svg: get };
})(window.CG);
