import {describe, expect, it} from "vitest"
import {isDefined, Option, Terminable, UUID} from "@opendaw/lib-std"
import {PPQN, ppqn} from "@opendaw/lib-dsp"
import {
    AnyRegionBoxAdapter,
    AudioRegionBoxAdapter,
    AudioUnitFactory,
    ProjectSkeleton,
    TrackBoxAdapter,
    TrackType
} from "@opendaw/studio-adapters"
import {AudioUnitType} from "@opendaw/studio-enums"
import {AudioFileBox, AudioRegionBox, AudioUnitBox, TrackBox, ValueEventCollectionBox} from "@opendaw/studio-boxes"
import type {Project} from "@opendaw/studio-core"
import {Crossfade} from "./Crossfade"

if (!isDefined(Reflect.get(globalThis, "AudioWorkletNode"))) {
    Reflect.set(globalThis, "AudioWorkletNode", class {})
}

const sampleManager = () => ({
    getOrCreate: (uuid: UUID.Bytes) => ({
        get data() {return Option.None}, get peaks() {return Option.None}, get uuid() {return uuid},
        get state() {return {type: "idle"} as const}, invalidate() {}, subscribe: () => Terminable.Empty
    }), record: () => {}, invalidate: () => {}, remove: () => {}, register: () => Terminable.Empty
})

type Spec = { position: ppqn, duration: ppqn, loopOffset?: ppqn, loopDuration?: ppqn }

const setup = async () => {
    const {Project} = await import("@opendaw/studio-core")
    const skeleton = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const {boxGraph, mandatoryBoxes: {primaryAudioUnitBox}} = skeleton
    boxGraph.beginTransaction()
    const trackBox = TrackBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(TrackType.Audio)
        box.tracks.refer(primaryAudioUnitBox.tracks)
        box.target.refer(primaryAudioUnitBox)
    })
    boxGraph.endTransaction()
    const project: Project = Project.fromSkeleton({
        audioContext: undefined, audioWorklets: undefined, sampleManager: sampleManager(),
        soundfontManager: undefined, sampleService: undefined, soundfontService: undefined
    } as unknown as Parameters<typeof Project.fromSkeleton>[0], skeleton)
    const audioUnitBox = primaryAudioUnitBox
    const region = (lane: TrackBox, {position, duration, loopOffset = 0, loopDuration = duration}: Spec): AudioRegionBoxAdapter =>
        project.boxAdapters.adapterFor(project.editing.modify(() => {
            const events = ValueEventCollectionBox.create(project.boxGraph, UUID.generate())
            // a file has to be used by an event the moment it exists: every event gets its own
            const fileBox = AudioFileBox.create(project.boxGraph, UUID.generate(), box => box.endInSeconds.setValue(60))
            return AudioRegionBox.create(project.boxGraph, UUID.generate(), box => {
                box.position.setValue(position)
                box.duration.setValue(duration)
                box.loopOffset.setValue(loopOffset)
                box.loopDuration.setValue(loopDuration)
                box.regions.refer(lane.regions)
                box.file.refer(fileBox)
                box.events.refer(events.owners)
            })
        }).unwrap(), AudioRegionBoxAdapter)
    const lanesOf = (unit: AudioUnitBox) => unit.tracks.pointerHub.incoming().map(({box}) => box as TrackBox)
        .sort((a, b) => a.index.getValue() - b.index.getValue())
    const run = (...selected: ReadonlyArray<AnyRegionBoxAdapter>) =>
        project.editing.modify(() => Crossfade.apply(project.boxAdapters, selected)).unwrap()
    const laneOf = (adapter: AudioRegionBoxAdapter) => adapter.box.regions.targetVertex.unwrap().box as TrackBox
    // a second audio unit, with a lane of its own
    const otherUnit = () => project.editing.modify(() => {
        const unit = AudioUnitFactory.create(project.skeleton, AudioUnitType.Bus, Option.None)
        const lane = TrackBox.create(project.boxGraph, UUID.generate(), box => {
            box.type.setValue(TrackType.Audio)
            box.tracks.refer(unit.tracks)
            box.target.refer(unit)
        })
        return {unit, lane}
    }).unwrap()
    return {project, audioUnitBox, trackBox, region, lanesOf, run, laneOf, otherUnit}
}

const snapshot = (...adapters: ReadonlyArray<AudioRegionBoxAdapter>) => adapters.map(adapter => ({
    position: adapter.position, duration: adapter.duration, loopOffset: adapter.loopOffset,
    fadeIn: adapter.fading.in, fadeOut: adapter.fading.out, lane: adapter.box.regions.targetVertex.unwrap().box.address.toString()
}))

// A recording that was cut in the middle: the two halves touch, and the sound goes on on both sides of the cut.
const cutPair = (region: Awaited<ReturnType<typeof setup>>["region"], lane: TrackBox, at: ppqn = PPQN.Quarter, length: ppqn = PPQN.Quarter * 2) =>
    [region(lane, {position: 0, duration: at, loopOffset: 0, loopDuration: length}),
        region(lane, {position: at, duration: length - at, loopOffset: at, loopDuration: length})] as const

describe("Crossfade", () => {
    it("pulls two touching events into each other and fades them over the same stretch", async () => {
        const {region, trackBox, audioUnitBox, lanesOf, run, laneOf} = await setup()
        const [a, b] = cutPair(region, trackBox)
        expect(lanesOf(audioUnitBox)).toHaveLength(1)
        const result = run(a, b)
        expect(result).toEqual({ok: true, length: 240, movedToNextLane: true})
        // the first one is pulled out by half the length, the second one is pulled back by half the length
        expect(a.position).toBe(0)
        expect(a.duration).toBe(960 + 120)
        expect(b.position).toBe(960 - 120)
        expect(b.duration).toBe(960 + 120)
        // the sound stays where it was: the second one starts earlier in the file by exactly as much
        expect(b.loopOffset).toBe(960 - 120)
        expect(b.position - b.loopOffset).toBe(960 - 960)
        // the fades are the overlap, to the tick
        expect(a.fading.out).toBe(240)
        expect(b.fading.in).toBe(240)
        expect(a.complete - b.position).toBe(240)
        // the second one is now on a lane of its own, the first one stayed
        expect(lanesOf(audioUnitBox)).toHaveLength(2)
        expect(laneOf(a)).toBe(trackBox)
        expect(laneOf(b)).toBe(lanesOf(audioUnitBox)[1])
        expect(laneOf(b).type.getValue()).toBe(TrackType.Audio)
        expect(laneOf(b).index.getValue()).toBe(trackBox.index.getValue() + 1)
    })

    it("closes a small gap from both sides, to the whole tick, odd gaps too", async () => {
        for (const gap of [140, 141]) {
            const {region, trackBox, run} = await setup()
            const a = region(trackBox, {position: 0, duration: 960, loopOffset: 0, loopDuration: 1920})
            const b = region(trackBox, {position: 960 + gap, duration: 960, loopOffset: 960, loopDuration: 1920})
            const result = run(a, b)
            expect(result).toEqual({ok: true, length: 240, movedToNextLane: true})
            expect(a.complete - b.position).toBe(240)
            expect(a.fading.out).toBe(240)
            expect(b.fading.in).toBe(240)
            expect(Number.isInteger(b.position)).toBe(true)
            // the junction (the middle of the old gap) is the middle of the new overlap
            // (a whole tick is the finest the position can be, so the middle can be half a tick off)
            expect(Math.abs((a.complete + b.position) / 2 - (960 + gap / 2))).toBeLessThanOrEqual(0.5)
        }
    })

    it("takes only as much as the sound beyond the ends allows", async () => {
        const {region, trackBox, run} = await setup()
        // 100 ticks of sound left after the first event, plenty before the second
        const a = region(trackBox, {position: 0, duration: 900, loopOffset: 0, loopDuration: 1000})
        const b = region(trackBox, {position: 900, duration: 900, loopOffset: 900, loopDuration: 1800})
        const result = run(a, b)
        expect(result).toEqual({ok: true, length: 200, movedToNextLane: true})
        expect(a.loopOffset + a.duration).toBe(a.loopDuration) // used up all of it, and not a tick more
        expect(b.loopOffset).toBe(800)
    })

    it("says no when there is no sound to spare after the first event or before the second", async () => {
        const first = await setup()
        const noTail = first.region(first.trackBox, {position: 0, duration: 960, loopOffset: 0, loopDuration: 960})
        const withHead = first.region(first.trackBox, {position: 960, duration: 960, loopOffset: 500, loopDuration: 1460})
        const before = snapshot(noTail, withHead)
        const result = first.run(noTail, withHead)
        expect(result).toMatchObject({ok: false})
        expect((result as { reason: string }).reason).toContain("not enough sound")
        expect(snapshot(noTail, withHead)).toEqual(before)
        expect(first.lanesOf(first.audioUnitBox)).toHaveLength(1)

        const second = await setup()
        const withTail = second.region(second.trackBox, {position: 0, duration: 960, loopOffset: 0, loopDuration: 1920})
        const noHead = second.region(second.trackBox, {position: 960, duration: 960, loopOffset: 0, loopDuration: 960})
        expect(second.run(withTail, noHead)).toMatchObject({ok: false})
        const tiny = await setup()
        const a = tiny.region(tiny.trackBox, {position: 0, duration: 960, loopOffset: 0, loopDuration: 970})
        const b = tiny.region(tiny.trackBox, {position: 960, duration: 960, loopOffset: 10, loopDuration: 970})
        expect(tiny.run(a, b)).toMatchObject({ok: false}) // 20 ticks of overlap is not a crossfade
    })

    it("says no when the events are too far apart", async () => {
        const {region, trackBox, run, lanesOf, audioUnitBox} = await setup()
        const a = region(trackBox, {position: 0, duration: 960, loopOffset: 0, loopDuration: 1920})
        const b = region(trackBox, {position: 960 + Crossfade.MaxGap + 1, duration: 960, loopOffset: 960, loopDuration: 1920})
        const result = run(a, b)
        expect(result).toMatchObject({ok: false})
        expect((result as { reason: string }).reason).toContain("too far")
        expect(lanesOf(audioUnitBox)).toHaveLength(1)
    })

    it("needs exactly two audio events of the same audio unit", async () => {
        const {region, trackBox, run, otherUnit} = await setup()
        const [a, b] = cutPair(region, trackBox)
        const c = region(trackBox, {position: 5000, duration: 960, loopDuration: 1920, loopOffset: 0})
        expect(run(a)).toMatchObject({ok: false})
        expect(run()).toMatchObject({ok: false})
        expect(run(a, b, c)).toMatchObject({ok: false})
        const other = otherUnit()
        const elsewhere = region(other.lane, {position: 960, duration: 960, loopOffset: 960, loopDuration: 1920})
        const result = run(a, elsewhere)
        expect(result).toMatchObject({ok: false})
        expect((result as { reason: string }).reason).toContain("different tracks")
    })

    it("does not care in which order the two were selected", async () => {
        const {region, trackBox, run} = await setup()
        const [a, b] = cutPair(region, trackBox)
        expect(run(b, a)).toEqual({ok: true, length: 240, movedToNextLane: true})
        expect(a.fading.out).toBe(240)
        expect(b.fading.in).toBe(240)
    })

    it("uses the same two lanes for every crossfade of the track", async () => {
        const {region, trackBox, audioUnitBox, lanesOf, run, laneOf} = await setup()
        // one recording cut in four: A B C D touch
        const length = PPQN.Quarter * 4
        const parts = [0, 1, 2, 3].map(index => region(trackBox, {
            position: index * 960, duration: 960, loopOffset: index * 960, loopDuration: length
        }))
        const [a, b, c, d] = parts
        expect(run(a, b)).toMatchObject({ok: true, movedToNextLane: true})
        expect(lanesOf(audioUnitBox)).toHaveLength(2)
        // b is on the second lane, c on the first: no lane needs to be made, nothing moves
        expect(run(b, c)).toMatchObject({ok: true, movedToNextLane: false})
        expect(lanesOf(audioUnitBox)).toHaveLength(2)
        // c and d are on the same lane again: d goes to the same second lane
        expect(run(c, d)).toMatchObject({ok: true, movedToNextLane: true})
        expect(lanesOf(audioUnitBox)).toHaveLength(2)
        const [first, second] = lanesOf(audioUnitBox)
        expect([laneOf(a), laneOf(b), laneOf(c), laneOf(d)]).toEqual([first, second, first, second])
        // every junction is a crossfade of the same length, the fades meet exactly
        for (const [left, right] of [[a, b], [b, c], [c, d]] as const) {
            expect(left.complete - right.position).toBe(240)
            expect(left.fading.out).toBe(240)
            expect(right.fading.in).toBe(240)
        }
    })

    it("uses a lane that is already below, instead of making another one", async () => {
        const {region, trackBox, audioUnitBox, lanesOf, run, laneOf, project} = await setup()
        const below = project.editing.modify(() => TrackBox.create(project.boxGraph, UUID.generate(), box => {
            box.type.setValue(TrackType.Audio)
            box.index.setValue(trackBox.index.getValue() + 1)
            box.tracks.refer(audioUnitBox.tracks)
            box.target.refer(audioUnitBox)
        })).unwrap()
        const [a, b] = cutPair(region, trackBox)
        expect(run(a, b)).toMatchObject({ok: true, movedToNextLane: true})
        expect(lanesOf(audioUnitBox)).toHaveLength(2)
        expect(laneOf(b)).toBe(below)
    })

    it("does not touch anything when the lane below is busy there", async () => {
        const {region, trackBox, audioUnitBox, lanesOf, run, project} = await setup()
        const below = project.editing.modify(() => TrackBox.create(project.boxGraph, UUID.generate(), box => {
            box.type.setValue(TrackType.Audio)
            box.index.setValue(trackBox.index.getValue() + 1)
            box.tracks.refer(audioUnitBox.tracks)
            box.target.refer(audioUnitBox)
        })).unwrap()
        const [a, b] = cutPair(region, trackBox)
        const blocker = region(below, {position: 900, duration: 200, loopDuration: 200, loopOffset: 0})
        const before = snapshot(a, b, blocker)
        const result = run(a, b)
        expect(result).toMatchObject({ok: false})
        expect((result as { reason: string }).reason).toContain("lane below")
        expect(snapshot(a, b, blocker)).toEqual(before)
        expect(lanesOf(audioUnitBox)).toHaveLength(2)
    })

    it("does not run into an event that lies between", async () => {
        const {region, trackBox, run, audioUnitBox, lanesOf} = await setup()
        const a = region(trackBox, {position: 0, duration: 960, loopOffset: 0, loopDuration: 1920})
        const between = region(trackBox, {position: 1000, duration: 40, loopOffset: 0, loopDuration: 40})
        const b = region(trackBox, {position: 1100, duration: 960, loopOffset: 960, loopDuration: 1920})
        const before = snapshot(a, between, b)
        const result = run(a, b)
        expect(result).toMatchObject({ok: false})
        expect((result as { reason: string }).reason).toContain("in the way")
        expect(snapshot(a, between, b)).toEqual(before)
        expect(lanesOf(audioUnitBox)).toHaveLength(1)
    })

    it("sets the fades of an overlap that is there already, and nothing else", async () => {
        const {region, trackBox, audioUnitBox, run, project} = await setup()
        const below = project.editing.modify(() => TrackBox.create(project.boxGraph, UUID.generate(), box => {
            box.type.setValue(TrackType.Audio)
            box.index.setValue(trackBox.index.getValue() + 1)
            box.tracks.refer(audioUnitBox.tracks)
            box.target.refer(audioUnitBox)
        })).unwrap()
        const a = region(trackBox, {position: 0, duration: 1100, loopOffset: 0, loopDuration: 1920})
        const b = region(below, {position: 900, duration: 1000, loopOffset: 900, loopDuration: 1920})
        expect(run(a, b)).toEqual({ok: true, length: 200, movedToNextLane: false})
        expect(a.fading.out).toBe(200)
        expect(b.fading.in).toBe(200)
        expect(a.duration).toBe(1100)
        expect(b.position).toBe(900)
    })

    it("is one undo step", async () => {
        const {region, trackBox, audioUnitBox, lanesOf, run, project} = await setup()
        const [a, b] = cutPair(region, trackBox)
        const before = snapshot(a, b)
        run(a, b)
        expect(lanesOf(audioUnitBox)).toHaveLength(2)
        project.editing.undo()
        expect(lanesOf(audioUnitBox)).toHaveLength(1)
        expect(snapshot(a, b)).toEqual(before)
        expect(project.boxAdapters.adapterFor(trackBox, TrackBoxAdapter).regions.collection.asArray()).toHaveLength(2)
    })

    it("keeps an existing fade-in of the first event and fade-out of the second", async () => {
        const ctx = await setup()
        const {region, trackBox, run} = ctx
        const [a, b] = cutPair(region, trackBox)
        const {project} = ctx
        project.editing.modify(() => {
            a.fading.inField.setValue(100)
            b.fading.outField.setValue(100)
        })
        expect(run(a, b)).toMatchObject({ok: true})
        expect(a.fading.in).toBe(100)
        expect(b.fading.out).toBe(100)
    })
})
