"""fontra-mcp: MCP server + CLI bridging Fontra to AI agents.

Agents can inspect fonts, glyphs, kerning, axes and design guidance, and —
when the server runs with FONTRA_MCP_ALLOW_WRITES=1 — design fonts through
Fontra's own backend: build a glyph, place components, set anchors, add
masters, interpolate and kern. A workflow planner turns a set of starting
glyphs into an ordered, component-based build plan.
"""

__all__ = ["__version__"]
__version__ = "1.1.0"
