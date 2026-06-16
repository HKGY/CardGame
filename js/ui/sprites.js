window.CG = window.CG || {};

/* ===========================================================================
 *  角色贴图 —— 用内联 SVG 画的简易“图形贴图”，自包含、无需图片资源。
 *  敌人数据里的 sprite 字段对应这里的 key；找不到就用 blob 兜底。
 *  想加新贴图：往下面对象里加一段 SVG 即可（viewBox 统一 0 0 120 140）。
 * ===========================================================================
 */
(function (CG) {
  const S = {
    // 玩家：蓝甲骑士，面朝右（左手剑、右手盾，朝向敌人）
    knight: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="34" ry="8" fill="#0003"/>
      <rect x="22" y="48" width="6" height="52" rx="3" fill="#dfe6f0"/>
      <rect x="18" y="92" width="16" height="6" rx="3" fill="#8a6b2a"/>
      <rect x="38" y="60" width="44" height="56" rx="14" fill="#3a6ea5"/>
      <rect x="46" y="112" width="12" height="22" rx="5" fill="#2a4d70"/>
      <rect x="62" y="112" width="12" height="22" rx="5" fill="#2a4d70"/>
      <rect x="40" y="20" width="40" height="46" rx="16" fill="#7aa7d6"/>
      <rect x="46" y="40" width="30" height="8" rx="4" fill="#1a2433"/>
      <rect x="58" y="10" width="4" height="12" fill="#f0c040"/>
      <circle cx="60" cy="8" r="5" fill="#f0c040"/>
      <path d="M84 66 q16 4 16 20 q0 18 -16 24 q-16 -6 -16 -24 q0 -16 16 -20z"
            fill="#c9d6e8" stroke="#2a3b52" stroke-width="2"/>
      <circle cx="84" cy="86" r="5" fill="#f0c040"/>
    </svg>`,

    // 颚虫：绿色分节虫，大嘴利齿
    worm: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="38" ry="8" fill="#0003"/>
      <ellipse cx="60" cy="98" rx="42" ry="30" fill="#5a8f3f"/>
      <ellipse cx="60" cy="74" rx="36" ry="26" fill="#6aa84f"/>
      <ellipse cx="60" cy="50" rx="29" ry="22" fill="#84bb63"/>
      <path d="M38 54 q22 30 44 0 q-22 12 -44 0z" fill="#3a2222"/>
      <polygon points="43,54 47,66 51,54" fill="#fff"/>
      <polygon points="56,57 60,70 64,57" fill="#fff"/>
      <polygon points="69,54 73,66 77,54" fill="#fff"/>
      <circle cx="49" cy="40" r="7" fill="#fff"/><circle cx="50" cy="41" r="3.5" fill="#111"/>
      <circle cx="71" cy="40" r="7" fill="#fff"/><circle cx="70" cy="41" r="3.5" fill="#111"/>
    </svg>`,

    // 邪教徒：紫袍兜帽，红色眼睛
    cultist: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="32" ry="8" fill="#0003"/>
      <path d="M60 30 L94 126 L26 126 Z" fill="#5b3a8c"/>
      <path d="M60 14 q28 6 28 44 q-28 -16 -56 0 q0 -38 28 -44z" fill="#43286a"/>
      <ellipse cx="60" cy="54" rx="15" ry="17" fill="#170e22"/>
      <circle cx="54" cy="54" r="3.2" fill="#ff5a5a"/>
      <circle cx="66" cy="54" r="3.2" fill="#ff5a5a"/>
      <rect x="38" y="88" width="44" height="9" rx="4" fill="#6b4aa0"/>
      <circle cx="60" cy="92" r="7" fill="#f0c040"/>
    </svg>`,

    // 兜底贴图：灰色史莱姆
    blob: `<svg viewBox="0 0 120 140" class="char">
      <ellipse cx="60" cy="132" rx="32" ry="8" fill="#0003"/>
      <path d="M28 104 q0 -54 32 -54 q32 0 32 54 q-32 14 -64 0z" fill="#8a8f9e"/>
      <circle cx="50" cy="84" r="6" fill="#fff"/><circle cx="51" cy="85" r="3" fill="#111"/>
      <circle cx="70" cy="84" r="6" fill="#fff"/><circle cx="69" cy="85" r="3" fill="#111"/>
    </svg>`,
  };

  CG.Sprites = { get: name => S[name] || S.blob };
})(window.CG);
