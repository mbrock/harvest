// The mixer's output on the web: an AudioWorklet that plays blocks the page's main thread mixes
// ahead of it, without threads or shared memory (see docs/port/web.md, "Audio").

#ifndef PORT_AUDIO_WEBAUDIOOUTPUT_H
#define PORT_AUDIO_WEBAUDIOOUTPUT_H

namespace port {
namespace audio {

class Mixer;

//! Creates the page's AudioContext and starts feeding it from `mixer`. Returns the sample rate the
//! mixer must mix at, or 0 when the browser has no Web Audio.
unsigned int startWebAudioOutput(Mixer* mixer);
//! Stops the output and closes the AudioContext.
void stopWebAudioOutput();

} // end namespace audio
} // end namespace port

#endif
