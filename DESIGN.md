---
name: ALTO PALS Governed Analytics Copilot
description: A governed command centre for sales numbers, in a light and a dark theme.
colors:
  brand-orange: "#fa582d"
  brand-orange-text: "#c23b16"
  brand-orange-deep: "#a3310f"
  charcoal: "#1b1d21"
  page: "#f3f4f6"
  page-dark: "#0b0c0f"
  rail: "#fbfbfc"
  rail-dark: "#0f1014"
  card: "#ffffff"
  card-dark: "#14161a"
  surface-2: "#f6f7f9"
  surface-2-dark: "#1b1d22"
  text: "#16181c"
  text-dark: "#eceef2"
  muted: "#5b6270"
  muted-dark: "#a2a9b5"
  line: "#e2e5ea"
  line-dark: "#262930"
  line-strong: "#c9ced6"
  line-strong-dark: "#3a3e48"
  link-dark: "#ff8f66"
  button-dark: "#ff6a3d"
  on-button-dark: "#1a0a04"
  ok: "#177245"
  ok-dark: "#43d095"
  warn-text: "#8a5d00"
  warn-text-dark: "#f2bd55"
  bad: "#c53030"
  bad-dark: "#ff7070"
  synthetic-badge: "#ffd84d"
typography:
  page-title:
    fontFamily: "Manrope, Segoe UI, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  card-title:
    fontFamily: "Manrope, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    lineHeight: 1.3
  figure:
    fontFamily: "Manrope, Segoe UI, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Manrope, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  control: "10px"
  card: "12px"
  pill: "999px"
spacing:
  gutter: "16px"
  card: "22px"
  page: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand-orange-text}"
    textColor: "{colors.card}"
    rounded: "{rounded.control}"
    padding: "11px 22px"
  button-primary-dark:
    backgroundColor: "{colors.button-dark}"
    textColor: "{colors.on-button-dark}"
    rounded: "{rounded.control}"
    padding: "11px 22px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "22px"
  card-dark:
    backgroundColor: "{colors.card-dark}"
    rounded: "{rounded.card}"
    padding: "22px"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "6px 13px"
---

# Design

## Overview

A governed command centre for sales numbers. The reference was a dark operations console (left rail, a status panel,
a glowing hub with nodes around it, KPI tiles); the copilot takes the idea, not the look. The hub is the reviewed metric
registry, the nodes are the three sales regions, and what lights a region is the signed-in person's own access. Nothing
on screen claims a live measurement the app doesn't make: there are no status lights, uptime or activity feeds.

Mode is Operate: people come to read a number and trust it. Scanability and honesty come before effect. The brand lives
in a few precise details: one orange, the hub's light, monospace labels, and the flow along the lit spokes.

Both themes are first-class. Each token in `app/globals.css` holds its light and dark value with `light-dark()`. The
page follows the system setting until someone uses the switch in the top bar; the choice is saved in an httpOnly cookie
and put on `<html data-theme>` by the server, so the first paint is already right. The sign-in stage stays dark in both.

## Colors

- **Signature orange (`#fa582d`)** is for marks, rings, glows and the current item: never for running text on white,
  where it falls under 4.5:1. Text and buttons take `--link` / `--button`: `#c23b16` in light, `#ff8f66` / `#ff6a3d`
  in dark (dark text on the dark-theme button).
- **Neutrals** are cool greys from a charcoal base. The page sits a step below the cards in both themes, and the rail a
  half-step above the page.
- **Status** colours carry the coverage bands only: red below 2.00x, amber up to the 3.00x target, green at or above it.
  Words always travel with the colour ("Off target", "On target").
- **The yellow synthetic-data badge** is the one loud colour, on purpose: it must be seen on every page.

Named rule: every text token is 4.5:1 or better on every surface in its theme; input borders are 3:1 on the card.

## Typography

Manrope for everything people read; IBM Plex Mono, uppercase with wide tracking, only for small labels (tile labels,
table heads, "In your view"). Both ship with the app. Figures use tabular numbers so columns and tiles line up.

Hierarchy: page title 28/800, card title 17/800, figure 34/800 (30 on a region card), body 15/1.55, notes 12.5 to 13 in
the muted colour, labels 11 mono.

## Layout

- **Shell** (`app/app-shell.tsx`, `shell.css`): a 228px rail (brand, navigation, "How numbers are kept") and a sticky
  top bar (title, synthetic badge, theme switch, who is signed in). At 900px and below the rail becomes a strip across
  the top and the facts panel gives way to the page.
- **Overview**: page head, the region map card, the headline tiles, the conversation, the rulebook. Content is capped at
  1240px.
- **Region map** (`app/scope-map.tsx`, `overview.css`): the hub in the middle, Central above, West and East either side,
  joined by spokes across the grid gap. It is a container query, not a media query: under 720px of its own width the
  regions stack under a compact hub and the spokes go.
- **Tiles**: three in a row from 1280px; below that, and in the Graphs view, coverage takes its own row.

## Elevation & Depth

Flat cards with a 1px line and a soft two-part shadow (`--elev`). Depth in the dark theme comes from light, not shadow:
the hub's glow, the lit regions' faint orange halo, the glow under a live spoke. Locked regions lose their fill and
shadow and take a dashed border, so "out of reach" reads as absent, not as zero.

## Shapes

Radii: 10px for controls, 12px for cards and the map, pills for chips and switches, a circle for the hub. Icons are line
drawings on a 24-unit grid with a 1.75 stroke (`app/icons.tsx`) and always sit next to words.

## Components

- **Buttons**: one primary (Ask) in `--button`; everything else is an outlined control on the card colour that turns
  orange-tinted on hover.
- **Theme switch**: a 36px square in the top bar; the icon shows the theme it switches to. Works without JavaScript.
- **Region card**: name and state on one line, then the coverage figure with its standing, the bar with the target line,
  and the two figures it is made of. Locked: name, a lock, and one sentence on why.
- **Notices** (asked back, refused, failed): a full 1px border and a tinted fill per kind. No side stripes.
- **Graphs** (`chart3d.css`, shared byte-for-byte with the alerts app): colours come from `--c3d-*` tokens with the light
  colour as fallback, so the alerts app, which sets none, is unchanged.

## Do's and Don'ts

- Do show a region outside someone's access as locked, never as 0 or as a blank number.
- Do keep words next to every colour that carries meaning.
- Do use the orange sparingly: one current item, one hub, the lit spokes.
- Don't add status lights, live counters or activity feeds the app can't back with data.
- Don't put orange text on white; use `--link`.
- Don't add motion beyond the spokes' flow and the graphs' own transitions; reduced motion stops both.
