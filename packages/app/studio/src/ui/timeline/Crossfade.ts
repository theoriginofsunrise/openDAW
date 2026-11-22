import {ppqn, PPQN} from "@opendaw/lib-dsp"
import {asInstanceOf, int, mod, UUID} from "@opendaw/lib-std"
import {IndexedBox} from "@opendaw/lib-box"
import {AnyRegionBoxAdapter, AudioRegionBoxAdapter, BoxAdapters, TrackBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {AudioUnitBox, TrackBox} from "@opendaw/studio-boxes"

/**
 * X-F: a crossfade between two audio events that follow each other.
 *
 * Both events must be on the same audio unit, close together, and have sound to spare where they meet: the first
 * one beyond its end, the second one before its start (the part that was trimmed away, or that a cut left on the
 * other side). The first event is pulled out past the junction and fades out, the second is pulled back before it and
 * fades in, over exactly the same stretch. For them to overlap, the second event moves to the next lane of the same
 * audio unit (made once, and used again by every crossfade of this track).
 *
 * Does everything or nothing: when something is not right it says what and changes nothing. Call it inside an
 * editing transaction.
 */
export namespace Crossfade {
    /** The crossfade is at most this long (a sixteenth note), as much as the sound that is there allows. */
    export const MaxLength: ppqn = PPQN.SemiQuaver
    /** Less overlap than this is not a crossfade (a thirty-second of a sixteenth). */
    export const MinLength: ppqn = 30
    /** Further apart than this the events do not belong together. */
    export const MaxGap: ppqn = PPQN.SemiQuaver

    export type Result =
        | { readonly ok: true, readonly length: ppqn, readonly movedToNextLane: boolean }
        | { readonly ok: false, readonly reason: string }

    const fail = (reason: string): Result => ({ok: false, reason})

    const laneOf = (region: AudioRegionBoxAdapter): TrackBox =>
        asInstanceOf(region.box.regions.targetVertex.unwrap("The event is on no lane").box, TrackBox)

    const unitOf = (lane: TrackBox): AudioUnitBox =>
        asInstanceOf(lane.tracks.targetVertex.unwrap("The lane is in no audio unit").box, AudioUnitBox)

    const lanesOf = (unit: AudioUnitBox): ReadonlyArray<TrackBox> =>
        unit.tracks.pointerHub.incoming()
            .map(({box}) => asInstanceOf(box, TrackBox))
            .filter(lane => lane.type.getValue() === TrackType.Audio)
            .sort((a, b) => a.index.getValue() - b.index.getValue())

    const regionsOnLane = (adapters: BoxAdapters, lane: TrackBox): ReadonlyArray<AnyRegionBoxAdapter> =>
        adapters.adapterFor(lane, TrackBoxAdapter).regions.collection.asArray()

    // does anything else lie in [from, to) on the lane?
    const occupied = (adapters: BoxAdapters, lane: TrackBox, from: ppqn, to: ppqn,
                      ignore: ReadonlyArray<AnyRegionBoxAdapter>): boolean =>
        regionsOnLane(adapters, lane).some(region =>
            !ignore.some(other => other.address.equals(region.address))
            && region.position < to && region.complete > from)

    export const apply = (adapters: BoxAdapters, selected: ReadonlyArray<AnyRegionBoxAdapter>): Result => {
        if (selected.length !== 2) {return fail("Select two events that follow each other on the same track.")}
        if (!selected[0].isAudioRegion() || !selected[1].isAudioRegion()) {return fail("X-F works on audio events.")}
        const [first, second] = [selected[0], selected[1]]
            .sort((a, b) => a.position - b.position || a.complete - b.complete)
        const firstLane = laneOf(first)
        const secondLane = laneOf(second)
        const unit = unitOf(firstLane)
        if (unitOf(secondLane) !== unit) {return fail("The two events are on different tracks.")}
        const sameLane = firstLane === secondLane
        const gap: ppqn = second.position - first.complete
        if (gap < 0 && sameLane) {return fail("These events overlap on the same lane.")}
        if (gap > MaxGap) {return fail("The events are too far apart for a crossfade.")}

        // an overlap that is already there (from an earlier crossfade): only the fades are set to it
        if (gap < 0) {
            const overlap = Math.floor(-gap)
            if (overlap < MinLength) {return fail("The events overlap by too little for a crossfade.")}
            if (overlap > first.duration - first.fading.in || overlap > second.duration - second.fading.out) {
                return fail("The overlap is longer than the events can fade.")
            }
            first.fading.outField.setValue(overlap)
            second.fading.inField.setValue(overlap)
            return {ok: true, length: overlap, movedToNextLane: false}
        }

        // The sound to spare: after the end of the first event, and before the start of the second one.
        const tail = Math.max(0, first.loopDuration - (first.loopOffset + first.duration))
        const head = Math.max(0, second.loopOffset)
        const half = Math.min(MaxLength / 2, Math.min(tail, head) - gap / 2)
        // whole ticks: the first event grows by ceil(gap/2) + half, the second by floor(gap/2) + half
        const margin: int = Math.floor(half)
        if (margin * 2 < MinLength) {return fail("There is not enough sound beyond the ends of these events to overlap.")}
        const growFirst: int = Math.ceil(gap / 2) + margin
        const growSecond: int = Math.floor(gap / 2) + margin
        const length: ppqn = growFirst + growSecond - gap
        if (length > first.duration + growFirst - first.fading.in
            || length > second.duration + growSecond - second.fading.out) {
            return fail("The events are too short for a crossfade this long.")
        }

        const newSecondPosition = second.position - growSecond
        const newFirstComplete = first.complete + growFirst
        // Which lane does the second event end up on? On the one below the first, or where it already is.
        let target: TrackBox | null = secondLane
        let createLaneAt: int = -1
        if (sameLane) {
            const lanes = lanesOf(unit)
            const next = lanes[lanes.indexOf(firstLane) + 1]
            if (next === undefined) {
                target = null
                createLaneAt = firstLane.index.getValue() + 1
            } else {
                target = next
                if (occupied(adapters, next, newSecondPosition, second.complete, [second])) {
                    return fail("The lane below is not free where the second event goes.")
                }
            }
            if (occupied(adapters, firstLane, first.complete, newFirstComplete, [first, second])) {
                return fail("Another event is in the way of the first event.")
            }
        } else {
            if (occupied(adapters, firstLane, first.complete, newFirstComplete, [first, second])) {
                return fail("Another event is in the way of the first event.")
            }
            if (occupied(adapters, secondLane, newSecondPosition, second.position, [first, second])) {
                return fail("Another event is in the way of the second event.")
            }
        }

        // Nothing is wrong: change things.
        if (target === null) {
            const index = IndexedBox.insertOrder(unit.tracks, createLaneAt)
            target = TrackBox.create(unit.graph, UUID.generate(), box => {
                box.type.setValue(TrackType.Audio)
                box.index.setValue(index)
                box.tracks.refer(unit.tracks)
                box.target.refer(unit)
            })
        }
        const moved = target !== secondLane
        if (moved) {second.box.regions.refer(target.regions)}
        // the first event is pulled out past the junction (what the end handle does)
        first.duration = first.duration + growFirst
        // the second event is pulled back before it (what the start handle does)
        second.position = second.position - growSecond
        second.duration = second.duration + growSecond
        second.loopOffset = mod(second.loopOffset - growSecond, second.loopDuration)
        // fading out over the same stretch as the other fades in
        first.fading.outField.setValue(length)
        second.fading.inField.setValue(length)
        return {ok: true, length, movedToNextLane: moved}
    }
}
