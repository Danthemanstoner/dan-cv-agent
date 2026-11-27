Nearly there: the arcade menu, one-click quiz, Order catcher pop-up, the header and the note all work. Three last fixes, then report. Don't publish.

1. The chips row and the input still float over the end of the conversation: the last card's link and stats sit underneath them. Give the whole bottom area (chips + input + Speak) a solid #050a07 background band across the right-hand column, and add bottom padding to the conversation log equal to that band's height, so the newest card always ends just above the chips when scrolled to the bottom.

2. In Order catcher, the player is a generic figure with an amber visor. Use the pixel Agent Dan sprite from the mockup instead: the SPRITE object in agent-dan-mockup.html, 16x20 pixels, rows of characters where G = #00ff6a, D = #00b348, K = #050a07 and . = transparent. Show SPRITE.normal, and SPRITE.wink for half a second after catching a gold slip.

3. The mood line under the monitor shows "idle" all the time, even right after a question is asked. Wire it up: thinking from the moment a message is sent until the answer starts, talking while the answer appears, then idle; greeting once when the page opens and after a message is sent to Dan. Drive the face with the same mood. If Agentplace doesn't let the page know when the agent is working or streaming, tell me exactly what it does expose.

Report which of these you did and anything you couldn't.
