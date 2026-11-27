Two last fixes, then report. Don't publish; I'll publish myself.

1. The quick-reply chips and the input still float over the end of the conversation with no background behind them, so the last card's text shows through between the chips. Give the whole bottom area (chips + input + Speak) a solid #050a07 background band across the right-hand column (a thin #1a3d28 line on top is fine), and add bottom padding to the conversation log equal to that band's height, so the newest card always ends just above the chips when scrolled to the bottom.

2. In Order catcher, the player is a generic figure with an amber visor. Use the pixel Agent Dan sprite from the attached mockup instead: the SPRITE object in agent-dan-mockup.html, 16x20 pixels, rows of characters where G = #00ff6a, D = #00b348, K = #050a07 and . = transparent. Show SPRITE.normal, and SPRITE.wink for half a second after catching a gold slip.

The mood line now works, so leave it as it is.
