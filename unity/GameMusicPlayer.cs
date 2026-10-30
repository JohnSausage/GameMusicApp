// GameMusicPlayer: plays music exported from GameMusicApp in Unity.
//
// 1. Export the music as stems (Export → Audio… → "One file per track"), as WAV
//    or OGG, ideally with "Loop seamlessly" and "Also a beat map (JSON)".
// 2. Put the audio files and the .json into your Assets folder, and this script too.
// 3. Add GameMusicPlayer to a GameObject. Drag the audio files into "Layers" and the
//    .json into "Beat Map".
//
// All layers start at the same moment and stay in sync. From your scripts, fade
// a layer in or out, e.g. when a fight starts:
//
//     music.SetLayer("Drums", 1f, 2f);           // fade the drums in over 2 seconds
//     music.SetLayerOnNextBar("Lead", 0f);       // the lead stops at the next bar line
//
// With the beat map, OnBeat and OnBar tell your scripts when a beat or a bar
// starts (e.g. to make things pulse with the music), also where the tempo or the
// time signature changes, and CurrentSection says which section is playing.
//
// Layer names come from the files: "My song - Drums.wav" is the layer "Drums".
// The mix alone works too, as a single layer.

using System;
using UnityEngine;
using UnityEngine.Audio;

public class GameMusicPlayer : MonoBehaviour
{
    [Serializable]
    public class Layer
    {
        [Tooltip("Name for SetLayer, e.g. \"Drums\". Empty: from the clip's name, after its last \" - \".")]
        public string name;
        public AudioClip clip;
        [Tooltip("Volume at the start: 0 = silent (fade it in later), 1 = as exported.")]
        [Range(0f, 1f)] public float volume = 1f;

        [NonSerialized] public AudioSource source;
        [NonSerialized] public float target;
        [NonSerialized] public float speed;
        [NonSerialized] public double fadeAt;
    }

    [Tooltip("The exported audio files (WAV or OGG): the stems, or the mix.")]
    public Layer[] layers = new Layer[0];
    [Tooltip("The beat map (.json) exported with them: for OnBeat, OnBar and the sections. Optional.")]
    public TextAsset beatMap;
    public bool playOnStart = true;
    [Tooltip("Repeat the music. Export it with \"Loop seamlessly\" so it loops without a gap.")]
    public bool loop = true;
    [Tooltip("Mixer group for all layers. Optional.")]
    public AudioMixerGroup output;

    /// <summary>A beat starts; its number in the bar, from 0 (the first beat of the bar).</summary>
    public event Action<int> OnBeat;
    /// <summary>A bar starts; its number in the music, from 0 (counted again when it loops).</summary>
    public event Action<int> OnBar;

    /// <summary>The beat map, or null without one.</summary>
    public BeatMapData Map { get; private set; }
    public bool IsPlaying { get; private set; }

    double startTime;
    long lastBeat = -1;

    void Awake()
    {
        if (beatMap != null) Map = JsonUtility.FromJson<BeatMapData>(beatMap.text);
        foreach (var layer in layers)
        {
            if (string.IsNullOrEmpty(layer.name) && layer.clip != null)
            {
                string clipName = layer.clip.name;
                int dash = clipName.LastIndexOf(" - ", StringComparison.Ordinal);
                layer.name = dash >= 0 ? clipName.Substring(dash + 3) : clipName;
            }
            layer.source = gameObject.AddComponent<AudioSource>();
            layer.source.clip = layer.clip;
            layer.source.loop = loop;
            layer.source.playOnAwake = false;
            layer.source.outputAudioMixerGroup = output;
            layer.source.volume = layer.volume;
            layer.target = layer.volume;
        }
    }

    void Start()
    {
        if (playOnStart) Play();
    }

    /// <summary>Starts all layers together from the beginning, a moment from now so they start in sync.</summary>
    public void Play(double delay = 0.1)
    {
        Stop();
        startTime = AudioSettings.dspTime + delay;
        foreach (var layer in layers)
        {
            if (layer.clip != null) layer.source.PlayScheduled(startTime);
        }
        lastBeat = -1;
        IsPlaying = true;
    }

    public void Stop()
    {
        foreach (var layer in layers)
        {
            if (layer.source != null) layer.source.Stop();
        }
        IsPlaying = false;
    }

    /// <summary>Fades a layer to a volume (0 = silent, 1 = as exported) over some seconds.</summary>
    public void SetLayer(string name, float volume, float fadeSeconds = 1f)
    {
        Fade(name, volume, fadeSeconds, AudioSettings.dspTime);
    }

    /// <summary>Like SetLayer, but the fade starts at the next bar line (needs the beat map).</summary>
    public void SetLayerOnNextBar(string name, float volume, float fadeSeconds = 0f)
    {
        Fade(name, volume, fadeSeconds, NextBarTime());
    }

    /// <summary>The layer with this name (not case-sensitive), or null.</summary>
    public Layer GetLayer(string name)
    {
        foreach (var layer in layers)
        {
            if (string.Equals(layer.name, name, StringComparison.OrdinalIgnoreCase)) return layer;
        }
        return null;
    }

    /// <summary>Seconds since the music started (0 before), not counting loops.</summary>
    public double Elapsed
    {
        get { return IsPlaying ? Math.Max(0, AudioSettings.dspTime - startTime) : 0; }
    }

    /// <summary>Where the music is, in seconds from the start of the files (within the loop when looping).</summary>
    public double Position
    {
        get
        {
            double length = LoopLength;
            return loop && length > 0 ? Elapsed % length : Elapsed;
        }
    }

    /// <summary>The bar playing, from 0 (needs the beat map).</summary>
    public int CurrentBar
    {
        get { return Map == null ? 0 : BarAt(Position); }
    }

    /// <summary>The beat playing in its bar, from 0 (needs the beat map).</summary>
    public int CurrentBeat
    {
        get
        {
            if (Map == null) return 0;
            int bar = CurrentBar;
            double secondsPerBeat = HasBarTimes && bar < Map.barTimes.Length ? Map.barTimes[bar].secondsPerBeat : Map.secondsPerBeat;
            return secondsPerBeat > 0 ? (int)Math.Floor((Position - BarStart(bar)) / secondsPerBeat + 1e-9) : 0;
        }
    }

    /// <summary>Beat maps from version 2 on list every bar, so tempo and time-signature changes are followed.</summary>
    bool HasBarTimes
    {
        get { return Map != null && Map.barTimes != null && Map.barTimes.Length > 0; }
    }

    /// <summary>The bar at a position in seconds from the start of the files.</summary>
    int BarAt(double position)
    {
        if (!HasBarTimes) return Map.secondsPerBar > 0 ? (int)Math.Floor(position / Map.secondsPerBar + 1e-9) : 0;
        int bar = 0;
        while (bar + 1 < Map.barTimes.Length && Map.barTimes[bar + 1].start <= position + 1e-9) bar++;
        return bar;
    }

    /// <summary>Where a bar starts, in seconds from the start of the files (the bar after the last: where the music ends).</summary>
    double BarStart(int bar)
    {
        if (!HasBarTimes) return bar * Map.secondsPerBar;
        return bar < Map.barTimes.Length ? Map.barTimes[bar].start : Map.seconds;
    }

    /// <summary>The name of the section playing, or null (needs the beat map).</summary>
    public string CurrentSection
    {
        get
        {
            if (Map == null || Map.sections == null) return null;
            double position = Position;
            foreach (var section in Map.sections)
            {
                if (position >= section.start && position < section.end) return section.name;
            }
            return null;
        }
    }

    /// <summary>The DSP time (see AudioSettings.dspTime) of the next bar line; now without the beat map.</summary>
    public double NextBarTime()
    {
        if (Map == null || !IsPlaying || Map.secondsPerBar <= 0) return AudioSettings.dspTime;
        // The bar after the one playing, in this round of the loop.
        double length = LoopLength;
        double round = loop && length > 0 ? Math.Floor(Elapsed / length) * length : 0;
        return startTime + round + BarStart(BarAt(Elapsed - round) + 1);
    }

    /// <summary>How long one round of the music is: the beat map's length when it loops, else the first clip's.</summary>
    double LoopLength
    {
        get
        {
            if (Map != null && Map.loops && Map.seconds > 0) return Map.seconds;
            foreach (var layer in layers)
            {
                if (layer.clip != null) return layer.clip.length;
            }
            return 0;
        }
    }

    void Fade(string name, float volume, float fadeSeconds, double at)
    {
        Layer layer = GetLayer(name);
        if (layer == null)
        {
            Debug.LogWarning("GameMusicPlayer: no layer named \"" + name + "\"");
            return;
        }
        layer.target = Mathf.Clamp01(volume);
        layer.speed = fadeSeconds > 0 ? Mathf.Abs(layer.target - layer.source.volume) / fadeSeconds : float.PositiveInfinity;
        layer.fadeAt = at;
    }

    void Update()
    {
        double now = AudioSettings.dspTime;
        foreach (var layer in layers)
        {
            if (layer.source == null || now < layer.fadeAt || layer.source.volume == layer.target) continue;
            layer.source.volume = float.IsPositiveInfinity(layer.speed)
                ? layer.target
                : Mathf.MoveTowards(layer.source.volume, layer.target, layer.speed * Time.unscaledDeltaTime);
        }

        // Without looping, the music is over after one round.
        if (IsPlaying && !loop && LoopLength > 0 && Elapsed >= LoopLength) IsPlaying = false;

        if (Map == null || !IsPlaying || now < startTime || Map.secondsPerBeat <= 0) return;
        // A number that changes with every beat: the round of the loop, the bar and the beat in it.
        double length = LoopLength;
        long round = loop && length > 0 ? (long)Math.Floor(Elapsed / length) : 0;
        int bar = CurrentBar;
        int beatInBar = CurrentBeat;
        long beat = (round * 1000000L + bar) * 1000L + beatInBar;
        if (beat == lastBeat) return;
        lastBeat = beat;
        if (beatInBar == 0 && OnBar != null) OnBar(bar);
        if (OnBeat != null) OnBeat(beatInBar);
    }
}

/// <summary>The beat map exported with the music (the .json file), as JsonUtility reads it.</summary>
[Serializable]
public class BeatMapData
{
    public string format;
    public int version;
    public string title;
    /// <summary>The part of the song in the files: empty (or null) for all of it, else e.g. "Chorus".</summary>
    public string range;
    /// <summary>The song's bar the files start with, counted from 1.</summary>
    public int firstBar;
    public double tempo;
    public int[] timeSignature;
    public int beatsPerBar;
    public double secondsPerBeat;
    public double secondsPerBar;
    public int bars;
    /// <summary>Every bar: where it starts, its beats and their length (version 2 on; they change with the tempo or time signature).</summary>
    public BarTimeData[] barTimes;
    /// <summary>How long the music is, without the ring-out.</summary>
    public double seconds;
    /// <summary>True when the files end exactly at the end of the music, to loop.</summary>
    public bool loops;
    public double tailSeconds;
    public int sampleRate;
    public int samples;
    public SectionData[] sections;
    /// <summary>The mix's file, if it was exported.</summary>
    public string mix;
    public StemData[] stems;

    [Serializable]
    public class SectionData
    {
        public string name;
        /// <summary>Bars count from 0, the files' first bar.</summary>
        public int bar;
        public int bars;
        public double start;
        public double end;
    }

    [Serializable]
    public class BarTimeData
    {
        /// <summary>Seconds from the start of the files.</summary>
        public double start;
        public int beats;
        public double secondsPerBeat;
    }

    [Serializable]
    public class StemData
    {
        public string file;
        public string name;
        public string[] tracks;
    }
}
