/**
 * description-filler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads every variable in the `foundation` Figma collection, generates a
 * deterministic 4-slot description for each one, and either previews the
 * results (DRY_RUN=true) or writes them back to Figma (DRY_RUN=false).
 *
 * Run via figma-console MCP → figma_execute (timeout: 25000)
 *
 * CONFIG FLAGS — edit before running:
 */
const DRY_RUN = true;   // true = preview only; false = write to Figma
const FORCE   = false;  // true = overwrite vars that already have descriptions
const GROUP   = null;   // null = all groups; or 'spacing' / 'colours' / etc.

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP TABLES  (single source of truth — mirrors token-description-strategy.md)
// ─────────────────────────────────────────────────────────────────────────────

const SCALE_LABELS = {
  0: 'Zero',
  1: 'Smallest',
  2: 'Extra-small',
  3: 'Small',
  4: 'Medium',
  5: 'Standard',
  6: 'Large',
  7: 'Extra-large',
};

const SIZING_S1 = {
  'input-height':          'Standard height for interactive controls.',
  'viewport':              'Reference viewport width for layout calculations.',
  'minimum-tappable-area': 'Minimum touch target size for accessibility compliance.',
};
const SIZING_S4 = {
  'input-height':          'Apply to buttons, text inputs, select menus, and any tappable control.',
  'viewport':              'Use as the baseline for container max-widths and fluid grid calculations.',
  'minimum-tappable-area': 'Apply as the minimum width and height of all interactive elements. Never go below this value.',
};

const RADIUS_S1 = {
  'zero':        'No border radius (0px).',
  'extra-small': 'Minimal border radius (6px).',
  'small':       'Small border radius.',
  'medium':      'Medium border radius.',
  'large':       'Large border radius.',
  'extra-large': 'Extra-large border radius.',
  'full':        'Full/pill border radius (999px).',
};
const RADIUS_S4 = {
  'zero':        'Use for sharp-cornered surfaces: table cells, full-bleed images, code blocks.',
  'extra-small': 'Use for inline elements: chips, badges, compact tags.',
  'small':       'Use for inline elements: chips, badges, compact tags.',
  'medium':      'Use for standard UI surfaces: cards, modals, panels.',
  'large':       'Use for prominent surfaces: sheets, drawers, hero containers.',
  'extra-large': 'Use for prominent surfaces: sheets, drawers, hero containers.',
  'full':        'Use for pill shapes: toggle tracks, avatar containers, lozenges.',
};

const TYPOGRAPHY_PROP_LABEL = {
  'size':              'Font size',
  'line-height':       'Line height',
  'weight':            'Font weight',
  'letter-spacing':    'Letter spacing',
  'paragraph-spacing': 'Paragraph spacing',
  'paragraph-indent':  'Paragraph indent',
  'font-family':       'Font family',
};
const TYPOGRAPHY_SCALE_USAGE = {
  'display':          'hero headings and page-level titles only',
  'title-L':          'primary section headings',
  'title-M':          'secondary section headings and card titles',
  'title-S':          'tertiary headings and modal titles',
  'subtitle':         'supporting text beneath headings',
  'paragraph':        'long-form body copy and editorial text',
  'body-L':           'primary body text in content-heavy layouts',
  'body-M-bold':      'emphasized body text, labels, and UI copy',
  'body-M-regular':   'default body text and form labels',
  'link-M-bold':      'prominent inline links and CTAs',
  'link-M-regular':   'standard inline links',
  'body-S-bold':      'captions, metadata, and secondary labels',
  'body-S-regular':   'fine print, timestamps, and helper text',
  'link-S-regular':   'supporting inline links and footnotes',
  'microcopy-bold':    'micro-UI labels: badges, chips, counters',
  'microcopy-regular': 'the smallest readable text in the system',
};

const ELEVATION_META = {
  'level-0':       { metaphor: 'flat',     surfaces: 'flat surfaces with no elevation: list items, table rows, inline elements' },
  'level-1':       { metaphor: 'subtle',   surfaces: 'slightly raised surfaces: cards, list containers, input fields' },
  'level-2':       { metaphor: 'raised',   surfaces: 'raised interactive surfaces: buttons, chips, hover states' },
  'level-3':       { metaphor: 'floating', surfaces: 'floating overlay surfaces: dropdowns, tooltips, snackbars' },
  'level-4':       { metaphor: 'prominent',surfaces: 'prominent overlays: drawers, side sheets, navigation rails' },
  'level-5':       { metaphor: 'modal',    surfaces: 'modal dialogs and full-screen overlays' },
  'level-6':       { metaphor: 'top',      surfaces: 'top-most surfaces: toasts, onboarding coachmarks' },
  'app-bar-top':   { metaphor: 'sticky',   surfaces: 'top app bar / sticky header' },
  'app-bar-bottom':{ metaphor: 'sticky',   surfaces: 'bottom navigation bar' },
  'FAB':           { metaphor: 'action',   surfaces: 'floating action button' },
};

const GRID_META = {
  'margins':          { s1: 'Outer page margin for the layout grid.',          s4: 'Apply as the left/right padding on the outermost page container.' },
  'gutters':          { s1: 'Column gutter width for the layout grid.',        s4: 'Apply as the gap between grid columns.' },
  'margins-overflow': { s1: 'Extended margin for overflow card layouts.',      s4: 'Use for card grids that bleed slightly beyond the standard page margin.' },
};

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

function resolveAlias(variable, varMap) {
  const modeId = Object.keys(variable.valuesByMode)[0];
  const val    = variable.valuesByMode[modeId];
  if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
    const target = varMap[val.id];
    return { isAlias: true, targetName: target ? target.name : val.id, targetVar: target };
  }
  return { isAlias: false, rawValue: val };
}

function resolveLeafValue(variable, varMap, depth) {
  depth = depth || 0;
  if (depth > 10) return null;
  const modeId = Object.keys(variable.valuesByMode)[0];
  const val    = variable.valuesByMode[modeId];
  if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
    const target = varMap[val.id];
    return target ? resolveLeafValue(target, varMap, depth + 1) : null;
  }
  return val;
}

function formatValue(rawValue, resolvedType) {
  if (rawValue === null || rawValue === undefined) return null;
  if (resolvedType === 'FLOAT') {
    return (Math.round(rawValue * 100) / 100) + 'px';
  }
  if (resolvedType === 'COLOR') {
    const r = Math.round(rawValue.r * 255);
    const g = Math.round(rawValue.g * 255);
    const b = Math.round(rawValue.b * 255);
    const a = rawValue.a !== undefined ? rawValue.a : 1;
    if (a < 1) return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(2) + ')';
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  return String(rawValue);
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

function generateSpacing(variable, alias, leaf) {
  const parts    = variable.name.split('/'); // spacing / [component|layout] / [step]
  const subGroup = parts[1] || '';
  const step     = parseInt(parts[2] || '0', 10);
  const label    = SCALE_LABELS[step] !== undefined ? SCALE_LABELS[step] : 'Largest';

  const s1 = label + ' ' + subGroup + ' spacing step.';
  const s2 = leaf !== null && leaf !== undefined ? formatValue(leaf, 'FLOAT') + ' base.' : null;
  const s3 = alias.isAlias ? 'Aliases ' + alias.targetName + ' (responsive).' : null;

  let s4;
  if (step === 0) {
    s4 = 'Use to explicitly zero out inherited spacing.';
  } else if (subGroup === 'component') {
    s4 = 'Use for internal component gaps: icon-to-label, input padding, list-item rows.';
  } else {
    s4 = 'Use for layout-level spacing: section gaps, content margins, vertical rhythm.';
  }

  return [s1, s2, s3, s4].filter(Boolean).join(' ');
}

function generateSizing(variable, alias, leaf) {
  const key = variable.name.split('/').slice(1).join('/'); // e.g. "input-height"
  const s1  = SIZING_S1[key] || 'Sizing token.';
  const s2  = leaf !== null && leaf !== undefined ? formatValue(leaf, 'FLOAT') + ' base.' : null;
  const s3  = alias.isAlias ? 'Aliases ' + alias.targetName + ' (responsive).' : null;
  const s4  = SIZING_S4[key] || 'Apply to interactive controls and containers.';
  return [s1, s2, s3, s4].filter(Boolean).join(' ');
}

function generateRadius(variable, alias, leaf) {
  const key = variable.name.split('/').slice(1).join('/'); // e.g. "medium"
  const px  = leaf !== null && leaf !== undefined ? Math.round(leaf) : null;

  // S1 already embeds the px value for zero/extra-small/full — use lookup directly
  let s1 = RADIUS_S1[key];
  if (!s1) {
    // Fallback: construct from px
    s1 = (px !== null ? px + 'px' : key) + ' border radius.';
  } else if (!['zero', 'extra-small', 'full'].includes(key) && px !== null) {
    // For small/medium/large/extra-large: inject resolved px into S1
    s1 = s1.replace('.', ' (' + px + 'px).');
  }

  const s3 = alias.isAlias ? 'Aliases ' + alias.targetName + '.' : 'Raw value — not aliased.';
  const s4 = RADIUS_S4[key] || 'Use for UI surfaces.';

  return [s1, s3, s4].join(' ');
}

function generateColours(variable, alias) {
  const parts    = variable.name.split('/'); // colours / [subGroup] / [tokenKey...]
  const subGroup = parts[1] || '';
  const tokenKey = parts.slice(2).join('/');

  // S1 — semantic role from subgroup + name pattern
  let s1 = 'Color token.';
  if (subGroup === 'basic') {
    if (tokenKey.startsWith('background')) {
      const mod = tokenKey.replace(/^background-?/, '').trim();
      s1 = mod ? 'Default ' + mod + ' background surface color.' : 'Default background surface color.';
    } else if (tokenKey.startsWith('text')) {
      const mod = tokenKey.replace(/^text-?/, '').trim();
      s1 = mod ? 'Default ' + mod + ' text color.' : 'Default text color.';
    } else if (tokenKey.startsWith('border')) {
      const mod = tokenKey.replace(/^border-?/, '').trim();
      s1 = mod ? 'Default ' + mod + ' border color.' : 'Default border color.';
    } else if (tokenKey.startsWith('icon')) {
      const mod = tokenKey.replace(/^icon-?/, '').trim();
      s1 = mod ? 'Default ' + mod + ' icon fill color.' : 'Default icon fill color.';
    }
  } else if (subGroup === 'shades') {
    s1 = 'Brand shade color at ' + tokenKey + ' tone.';
  } else if (subGroup === 'interaction-states') {
    if (tokenKey.startsWith('hover'))    s1 = 'Color applied to interactive elements on hover.';
    else if (tokenKey.startsWith('pressed'))  s1 = 'Color applied to interactive elements on press.';
    else if (tokenKey.startsWith('focus'))    s1 = 'Color for focus ring and keyboard-navigation indicators.';
    else if (tokenKey.startsWith('disabled')) s1 = 'Color for disabled-state elements.';
    else s1 = 'Interaction state color.';
  } else if (subGroup === 'functional') {
    if (tokenKey.startsWith('success')) s1 = 'Semantic success/positive-feedback color.';
    else if (tokenKey.startsWith('error'))   s1 = 'Semantic error/destructive-action color.';
    else if (tokenKey.startsWith('warning')) s1 = 'Semantic warning/caution color.';
    else if (tokenKey.startsWith('info'))    s1 = 'Semantic informational color.';
    else s1 = 'Functional semantic color.';
  }

  // S2 always omitted for colours (mode-adaptive)

  // S3
  const s3 = alias.isAlias ? 'Aliases ' + alias.targetName + ' (light/dark adaptive).' : null;

  // S4 — from scopes
  const scopes = variable.scopes || [];
  let s4;
  if (scopes.indexOf('ALL_SCOPES') !== -1)  s4 = 'Applies to fills, strokes, effects, and text as needed.';
  else if (scopes.indexOf('ALL_FILLS') !== -1) s4 = 'Apply to surface fills, icon fills, and illustration fills.';
  else if (scopes.indexOf('TEXT_FILL') !== -1) s4 = 'Apply to text elements only.';
  else s4 = 'Apply as needed.';

  // Pairing sentence — only for colours/basic/background* and colours/basic/text*
  let pairing = null;
  if (subGroup === 'basic') {
    if (tokenKey.startsWith('background-card')) {
      pairing = 'Pair with colours/basic/text and colours/basic/border.';
    } else if (tokenKey.startsWith('background')) {
      pairing = 'Pair with colours/basic/text.';
    } else if (tokenKey.startsWith('text')) {
      pairing = 'Pair with colours/basic/background.';
    }
  }

  return [s1, s3, s4, pairing].filter(Boolean).join(' ');
}

function generateTypography(variable, alias) {
  const parts      = variable.name.split('/'); // typography / [scale-level] / [property]
  const scaleLevel = parts[1] || '';
  const prop       = parts[2] || '';

  const propLabel    = TYPOGRAPHY_PROP_LABEL[prop] || prop;
  const usageContext = TYPOGRAPHY_SCALE_USAGE[scaleLevel] || scaleLevel;

  const s1 = propLabel + ' for ' + scaleLevel + ' text style.';
  const s3 = alias.isAlias ? 'Aliases ' + alias.targetName + ' (responsive).' : null;
  const s4 = 'Apply to ' + usageContext + '.';

  return [s1, s3, s4].filter(Boolean).join(' ');
}

function generateElevation(variable, alias, leaf) {
  const parts  = variable.name.split('/'); // elevation / [level] / [property]
  const level  = parts[1] || '';
  const prop   = parts[2] || '';

  const meta     = ELEVATION_META[level] || { metaphor: level, surfaces: level };
  const metaphor = meta.metaphor;
  const surfaces = meta.surfaces;

  // S1
  const levelLabel = metaphor + ' elevation (' + level + ' level)';
  let s1;
  if      (prop === 'colour') s1 = 'Shadow color for '            + levelLabel + '.';
  else if (prop === 'x')      s1 = 'Horizontal shadow offset for ' + levelLabel + '.';
  else if (prop === 'y')      s1 = 'Vertical shadow offset for '   + levelLabel + '.';
  else if (prop === 'blur')   s1 = 'Shadow blur radius for '       + levelLabel + '.';
  else if (prop === 'spread') s1 = 'Shadow spread radius for '     + levelLabel + '.';
  else                        s1 = 'Elevation property for '       + levelLabel + '.';

  // S2 — numeric properties only; skip for 'colour' (mode-adaptive)
  const isColourProp = prop === 'colour' || variable.resolvedType === 'COLOR';
  const s2 = !isColourProp && leaf !== null && leaf !== undefined
    ? formatValue(leaf, 'FLOAT') + '.'
    : null;

  // S3
  const s3 = alias.isAlias ? 'Aliases ' + alias.targetName + ' (light/dark adaptive).' : null;

  // S4
  const s4 = 'Apply to ' + surfaces + '.';

  return [s1, s2, s3, s4].filter(Boolean).join(' ');
}

function generateStrokes(variable, alias, leaf) {
  const key     = variable.name.split('/')[1] || '1'; // "1", "2", "3"
  const pxVal   = leaf !== null && leaf !== undefined ? Math.round(leaf) : parseInt(key, 10);
  const s1      = pxVal + 'px border width.';
  const s3      = alias.isAlias ? 'Aliases ' + alias.targetName + '.' : 'Raw value.';
  const s4      = 'Apply to input borders, card outlines, dividers, and focus rings.';
  const extra   = key === '2' ? 'Use for emphasized borders and active/selected states.' : null;
  return [s1, s3, s4, extra].filter(Boolean).join(' ');
}

function generateGrid(variable, alias) {
  const key  = variable.name.split('/').slice(1).join('/'); // e.g. "margins"
  const meta = GRID_META[key] || { s1: 'Layout grid token.', s4: 'Apply to grid layout containers.' };
  const s3   = alias.isAlias ? 'Aliases ' + alias.targetName + ' (responsive).' : null;
  const note = 'Not directly bindable in Figma — reference value for layout code and grid plugins only.';
  return [meta.s1, s3, meta.s4, note].filter(Boolean).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCHER
// ─────────────────────────────────────────────────────────────────────────────

function generateDescription(variable, varMap) {
  const group = variable.name.split('/')[0];
  const alias = resolveAlias(variable, varMap);
  const leaf  = resolveLeafValue(variable, varMap);

  switch (group) {
    case 'spacing':    return generateSpacing(variable, alias, leaf);
    case 'sizing':     return generateSizing(variable, alias, leaf);
    case 'radius':     return generateRadius(variable, alias, leaf);
    case 'colours':    return generateColours(variable, alias);
    case 'typography': return generateTypography(variable, alias);
    case 'elevation':  return generateElevation(variable, alias, leaf);
    case 'strokes':    return generateStrokes(variable, alias, leaf);
    case 'grid':       return generateGrid(variable, alias);
    default:           throw new Error('Unknown group: "' + group + '"');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

function validate(description, variable) {
  const errors    = [];
  const sentences = description.split(/(?<=[.!?])\s+/).filter(Boolean);

  if (sentences.length < 2) errors.push('Too short: fewer than 2 sentences');
  if (sentences.length > 5) errors.push('Too long: more than 5 sentences');

  const nameParts = variable.name.split('/');
  const leaf      = nameParts[nameParts.length - 1];
  if (sentences[0] && sentences[0].includes(leaf)) {
    errors.push('S1 contains the token leaf name "' + leaf + '"');
  }
  if (sentences[0] && sentences[0].toLowerCase().includes('foundation')) {
    errors.push('S1 contains collection name "foundation"');
  }

  const hasValueSentence = sentences.some(function(s) {
    return s.includes('px') || s.includes('rgba') || s.includes('rgb(') || s.includes('%');
  });
  const isColour = variable.name.startsWith('colours/');
  if (isColour && hasValueSentence) {
    errors.push('Colour token must not have a resolved value sentence (S2)');
  }

  const hasAliasSentence = sentences.some(function(s) { return s.startsWith('Aliases '); });
  const modeId = Object.keys(variable.valuesByMode)[0];
  const val    = variable.valuesByMode[modeId];
  const isAlias = val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS';
  if (isAlias && !hasAliasSentence) {
    errors.push('Aliased token is missing Aliases sentence (S3)');
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITER
// ─────────────────────────────────────────────────────────────────────────────

async function writeDescriptions(items) {
  for (var i = 0; i < items.length; i += 50) {
    var chunk = items.slice(i, i + 50);
    for (var j = 0; j < chunk.length; j++) {
      chunk[j].variable.description = chunk[j].proposed;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// READER
// ─────────────────────────────────────────────────────────────────────────────

async function readFoundation() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables   = await figma.variables.getLocalVariablesAsync();
  const varMap      = Object.fromEntries(variables.map(function(v) { return [v.id, v]; }));

  const foundationColl = collections.find(function(c) { return c.name === 'foundation'; });
  if (!foundationColl) throw new Error('Collection "foundation" not found in this file');

  const foundVars = variables.filter(function(v) {
    return v.variableCollectionId === foundationColl.id;
  });
  return { foundVars: foundVars, varMap: varMap, foundationColl: foundationColl };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const { foundVars, varMap } = await readFoundation();

  // Filter targets
  const targets = foundVars.filter(function(v) {
    if (GROUP && !v.name.startsWith(GROUP + '/')) return false;
    if (!FORCE && v.description && v.description.trim()) return false;
    return true;
  });

  // Skipped (had descriptions and FORCE=false)
  const skipped = foundVars.filter(function(v) {
    if (GROUP && !v.name.startsWith(GROUP + '/')) return false;
    return !FORCE && v.description && v.description.trim();
  }).map(function(v) { return v.name; });

  // Generate
  const toWrite = [];
  const failed  = [];

  for (var i = 0; i < targets.length; i++) {
    const v = targets[i];
    try {
      const desc   = generateDescription(v, varMap);
      const errors = validate(desc, v);
      if (errors.length > 0) {
        failed.push({ name: v.name, errors: errors });
      } else {
        toWrite.push({ name: v.name, current: v.description || '', proposed: desc, variable: v });
      }
    } catch (e) {
      failed.push({ name: v.name, errors: [e.message || String(e)] });
    }
  }

  const report = {
    summary:   toWrite.length + ' to write, ' + skipped.length + ' skipped, ' + failed.length + ' failed',
    generated: toWrite.map(function(r) { return { name: r.name, current: r.current, proposed: r.proposed }; }),
    skipped:   skipped,
    failed:    failed,
  };

  if (DRY_RUN) {
    return JSON.stringify(report, null, 2);
  }

  // Write
  await writeDescriptions(toWrite);
  return JSON.stringify(Object.assign({}, report, { written: toWrite.length }), null, 2);
}

return await main();
