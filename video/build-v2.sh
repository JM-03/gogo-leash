#!/usr/bin/env bash
# Assemble the Gogo Leash demo video v2: REAL screen recordings + narration.
# Segments are timed to the five narration files (measure with ffprobe).
# Run from /tmp/vidrec (frames + narr-seg*.mp3 live there).
# Output: ~/workspace/qorechain-gogo-leash/video/gogo-leash-demo.mp4
set -euo pipefail
cd /tmp/vidrec
REPO=~/workspace/qorechain-gogo-leash
mkdir -p build2
D1=12.53; D2=11.69; D3=20.16; D4=28.49; D5=12.77

# close card: only 6s recorded — hold the last frame to the segment length
rm -rf build2/close-ext; mkdir -p build2/close-ext
cp frames/close/*.jpg build2/close-ext/
LAST=$(ls build2/close-ext | tail -1)
for i in $(seq 181 383); do cp "build2/close-ext/$LAST" "build2/close-ext/$(printf %04d $i).jpg"; done

frames_to_mp4() { # $1=frames dir $2=seconds $3=out
  local n=$(python3 -c "print(round($2*30))")
  ffmpeg -y -v error -framerate 30 -i "$1/%04d.jpg" -frames:v "$n" \
    -c:v libx264 -pix_fmt yuv420p -r 30 "$3"
}
frames_to_mp4 frames/console $D1 build2/seg1.mp4
frames_to_mp4 frames/terminal $D3 build2/seg3.mp4
frames_to_mp4 frames/lab $D4 build2/seg4.mp4
frames_to_mp4 build2/close-ext $D5 build2/seg5.mp4

# diagram still with a slow zoom (same treatment as v1)
F2=$(python3 -c "print(round($D2*30))")
ffmpeg -y -v error -i "$REPO/video/shots/diagram.png" \
  -vf "zoompan=z='min(zoom+0.0004,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${F2}:s=1280x720:fps=30" \
  -frames:v "$F2" -c:v libx264 -pix_fmt yuv420p -r 30 build2/seg2.mp4

printf "file 'seg1.mp4'\nfile 'seg2.mp4'\nfile 'seg3.mp4'\nfile 'seg4.mp4'\nfile 'seg5.mp4'\n" > build2/vlist.txt
ffmpeg -y -v error -f concat -safe 0 -i build2/vlist.txt -c copy build2/video-only.mp4

printf "file '/tmp/vidrec/narr-seg1.mp3'\nfile '/tmp/vidrec/narr-seg2.mp3'\nfile '/tmp/vidrec/narr-seg3.mp3'\nfile '/tmp/vidrec/narr-seg4.mp3'\nfile '/tmp/vidrec/narr-seg5.mp3'\n" > build2/alist.txt
ffmpeg -y -v error -f concat -safe 0 -i build2/alist.txt -c:a libmp3lame -b:a 128k build2/narration-full.mp3

ffmpeg -y -v error -i build2/video-only.mp4 -i build2/narration-full.mp3 \
  -c:v copy -c:a aac -b:a 128k -shortest "$REPO/video/gogo-leash-demo.mp4"
cp build2/narration-full.mp3 "$REPO/video/assets/narration.mp3"
cp narration2.txt "$REPO/video/assets/narration.txt"
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$REPO/video/gogo-leash-demo.mp4"
ls -la "$REPO/video/gogo-leash-demo.mp4"
