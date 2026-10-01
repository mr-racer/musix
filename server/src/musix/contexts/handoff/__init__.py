"""Playback handoff, «Слушать на…» (phase 8 spec §1), modelled on Spotify Connect:
- presence says who is online and able to play;
- one active player per account publishes its state;
- a transfer tells the target to take over and the old player to let go;
- remote commands go to the player that owns the queue (the queue owner rule).
"""
