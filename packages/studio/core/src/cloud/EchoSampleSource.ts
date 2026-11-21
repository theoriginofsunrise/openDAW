import {Errors, Progress, UUID} from "@opendaw/lib-std"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {Sample, SampleMetaData} from "@opendaw/studio-adapters"
import {CloudHandler} from "./CloudHandler"
import {CloudBackupSamples} from "./CloudBackupSamples"

/**
 * An audio file that is in the cloud but not on this device yet, fetched at the moment a project needs it. This is
 * what makes a project that was saved on another device available right away: its audio comes along as it is played.
 */
export namespace EchoSampleSource {
    const CatalogMaxAge = 30 * 1000

    let cached: { handler: CloudHandler, at: number, samples: ReadonlyArray<Sample> } | null = null

    export const forgetCatalog = (): void => {cached = null}

    const catalog = async (handler: CloudHandler, now: number): Promise<ReadonlyArray<Sample>> => {
        if (cached !== null && cached.handler === handler && now - cached.at < CatalogMaxAge) {return cached.samples}
        const samples: ReadonlyArray<Sample> = await handler.download(CloudBackupSamples.RemoteCatalogPath)
            .then(json => JSON.parse(new TextDecoder().decode(json)))
            .catch(reason => reason instanceof Errors.FileNotFound ? [] : Promise.reject(reason))
        cached = {handler, at: now, samples}
        return samples
    }

    export const fetch = async (handler: CloudHandler, uuid: UUID.Bytes, progress: Progress.Handler,
                                now: number = Date.now()): Promise<[AudioData, SampleMetaData]> => {
        const uuidAsString = UUID.toString(uuid)
        let sample = (await catalog(handler, now)).find(entry => entry.uuid === uuidAsString)
        if (sample === undefined) {
            // the catalog may be older than the sample: look once more
            forgetCatalog()
            sample = (await catalog(handler, now)).find(entry => entry.uuid === uuidAsString)
        }
        if (sample === undefined) {throw new Errors.FileNotFound(`sample ${uuidAsString} is not in the cloud`)}
        progress(0.2)
        const buffer = await handler.download(CloudBackupSamples.pathFor(sample.uuid))
        progress(0.9)
        return [WavFile.decodeFloats(buffer), sample]
    }
}
