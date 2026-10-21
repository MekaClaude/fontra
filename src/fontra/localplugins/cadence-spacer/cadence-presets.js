// cadence-presets.js
//
// Built-in starter Spacing Tables (CUST), named after the same type
// categories the original LS Cadencer documentation uses on its
// "Fitting Results" pages (Renaissance Roman, Humanist Sans, Grotesk).
//
// IMPORTANT — these are *starting points*, not research data. The
// specific cadence-unit numbers below are reasonable, evenly-graded
// placeholders that follow the correct *structure* (which sides are
// "stem" vs "extreme", roughly which letters need more/less side
// units than an H), not digitized values from Frank Blokland's actual
// research. Anyone using this plugin seriously should treat a preset
// as a first draft: pick one, apply it, look at the result in the
// Space Center / canvas, and adjust the numbers in the CUST editor
// (or per-glyph, afterwards) to fit their design. This matches how
// the original tool's own manual describes its presets, too:
// "these will be a factor for calculating the sidebearings... Grid-
// Steps are set to 32 by default. A universal value which works for
// a relatively wide range of typefaces."

import { parseCust } from "./cadence-engine.js";

const RENAISSANCE_ROMAN_TEXT = `
nBeam=200
# Renaissance Roman — starter table (serif, moderate contrast)
A=XX,2,2,Beam
B=SX,10,6,Beam
C=XX,7,7,Beam
D=SX,10,7,Beam
E=SX,10,5,Beam
F=SX,10,2,Beam
G=XX,7,14,Beam
H=SS,10,10,Beam
I=SS,10,10,Beam
J=XS,1,10,Beam
K=SX,10,1,Beam
L=SX,10,1,Beam
M=SS,10,10,Beam
N=SS,10,12,Beam
O=XX,7,7,Beam
P=SX,10,3,Beam
Q=XX,7,7,Beam
R=SX,10,1,Beam
S=XX,6,7,Beam
T=XX,1,1,Beam
U=SS,11,11,Beam
V=XX,1,1,Beam
W=XX,1,1,Beam
X=XX,2,2,Beam
Y=XX,1,1,Beam
Z=XX,5,6,Beam
a=XS,5,9,Beam
b=SX,11,7,Beam
c=XX,6,7,Beam
d=XS,7,10,Beam
e=XX,6,7,Beam
f=SX,7,2,Beam
g=XS,5,6,Beam
h=SS,11,10,Beam
i=SS,7,7,Beam
j=XS,2,7,Beam
k=SX,11,2,Beam
l=SS,7,7,Beam
m=SS,11,11,Beam
n=SS,11,10,Beam
o=XX,6,6,Beam
p=SX,11,7,Beam
q=XS,7,11,Beam
r=SX,10,4,Beam
s=XX,5,6,Beam
t=SX,4,3,Beam
u=SS,10,11,Beam
v=XX,1,1,Beam
w=XX,1,1,Beam
x=XX,2,2,Beam
y=XX,1,1,Beam
z=XX,4,5,Beam
period=XX,10,10,Beam
comma=XX,10,3,Beam
colon=XX,10,10,Beam
semicolon=XX,10,3,Beam
`.trim();

const HUMANIST_SANS_TEXT = `
nBeam=200
# Humanist Sans — starter table (open counters, wide-ish rhythm)
A=XX,2,2,Beam
B=SX,12,7,Beam
C=XX,8,8,Beam
D=SX,12,8,Beam
E=SX,12,6,Beam
F=SX,12,3,Beam
G=XX,8,10,Beam
H=SS,12,12,Beam
I=SS,12,12,Beam
J=XS,2,12,Beam
K=SX,12,2,Beam
L=SX,12,2,Beam
M=SS,12,12,Beam
N=SS,12,12,Beam
O=XX,8,8,Beam
P=SX,12,4,Beam
Q=XX,8,8,Beam
R=SX,12,2,Beam
S=XX,7,7,Beam
T=XX,2,2,Beam
U=SS,12,12,Beam
V=XX,1,1,Beam
W=XX,1,1,Beam
X=XX,2,2,Beam
Y=XX,1,1,Beam
Z=XX,5,5,Beam
a=XS,6,9,Beam
b=SX,12,8,Beam
c=XX,7,7,Beam
d=XS,8,12,Beam
e=XX,7,7,Beam
f=SX,8,3,Beam
g=XS,6,7,Beam
h=SS,12,11,Beam
i=SS,8,8,Beam
j=XS,3,8,Beam
k=SX,12,3,Beam
l=SS,8,8,Beam
m=SS,11,11,Beam
n=SS,11,11,Beam
o=XX,7,7,Beam
p=SX,12,8,Beam
q=XS,8,12,Beam
r=SX,11,5,Beam
s=XX,6,6,Beam
t=SX,5,4,Beam
u=SS,11,12,Beam
v=XX,1,1,Beam
w=XX,1,1,Beam
x=XX,2,2,Beam
y=XX,1,1,Beam
z=XX,4,4,Beam
period=XX,11,11,Beam
comma=XX,11,4,Beam
colon=XX,11,11,Beam
semicolon=XX,11,4,Beam
`.trim();

const GROTESK_TEXT = `
nBeam=200
# Grotesk — starter table (tighter, more geometric rhythm)
A=XX,1,1,Beam
B=SX,9,6,Beam
C=XX,6,6,Beam
D=SX,9,6,Beam
E=SX,9,5,Beam
F=SX,9,2,Beam
G=XX,6,9,Beam
H=SS,9,9,Beam
I=SS,9,9,Beam
J=XS,1,9,Beam
K=SX,9,1,Beam
L=SX,9,1,Beam
M=SS,9,9,Beam
N=SS,9,9,Beam
O=XX,6,6,Beam
P=SX,9,3,Beam
Q=XX,6,6,Beam
R=SX,9,1,Beam
S=XX,5,5,Beam
T=XX,1,1,Beam
U=SS,9,9,Beam
V=XX,1,1,Beam
W=XX,1,1,Beam
X=XX,1,1,Beam
Y=XX,1,1,Beam
Z=XX,4,4,Beam
a=XS,4,7,Beam
b=SX,9,6,Beam
c=XX,5,5,Beam
d=XS,6,9,Beam
e=XX,5,5,Beam
f=SX,6,2,Beam
g=XS,4,5,Beam
h=SS,9,8,Beam
i=SS,6,6,Beam
j=XS,2,6,Beam
k=SX,9,2,Beam
l=SS,6,6,Beam
m=SS,8,8,Beam
n=SS,8,8,Beam
o=XX,5,5,Beam
p=SX,9,6,Beam
q=XS,6,9,Beam
r=SX,8,3,Beam
s=XX,4,4,Beam
t=SX,3,2,Beam
u=SS,8,9,Beam
v=XX,1,1,Beam
w=XX,1,1,Beam
x=XX,1,1,Beam
y=XX,1,1,Beam
z=XX,3,3,Beam
period=XX,8,8,Beam
comma=XX,8,2,Beam
colon=XX,8,8,Beam
semicolon=XX,8,2,Beam
# Uncomment to give the figures a fixed (tabular) width:
# tabular=zero,one,two,three,four,five,six,seven,eight,nine
# tabularWidth=600
`.trim();

export const CADENCE_PRESETS = {
  "Renaissance Roman": RENAISSANCE_ROMAN_TEXT,
  "Humanist Sans": HUMANIST_SANS_TEXT,
  Grotesk: GROTESK_TEXT,
};

export function getPresetNames() {
  return Object.keys(CADENCE_PRESETS);
}

export function loadPreset(name) {
  const text = CADENCE_PRESETS[name];
  if (!text) {
    throw new Error(`Unknown preset "${name}"`);
  }
  return { text, cust: parseCust(text) };
}
