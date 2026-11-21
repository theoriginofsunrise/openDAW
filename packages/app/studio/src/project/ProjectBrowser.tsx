import css from "./ProjectBrowser.sass?inline"
import {StudioService} from "@/service/StudioService"
import {
    DefaultObservableValue,
    Errors,
    isDefined,
    Lifecycle,
    Procedure,
    RuntimeNotifier,
    RuntimeSignal,
    TimeSpan,
    UUID
} from "@opendaw/lib-std"
import {Icon} from "@/ui/components/Icon"
import {MenuButton} from "@/ui/components/MenuButton"
import {Surface} from "@/ui/surface/Surface"
import {ProjectOrder} from "@/project/ProjectOrder"
import {renameProject} from "@/project/ProjectRename"
import {duplicateProject} from "@/project/ProjectDuplicate"
import {Colors, IconSymbol} from "@opendaw/studio-enums"
import {Dialogs} from "@/ui/components/dialogs"
import {Await, createElement, DomElement, Frag, Group, JsxValue} from "@opendaw/lib-jsx"
import {Files, Html} from "@opendaw/lib-dom"
import {Promises} from "@opendaw/lib-runtime"
import {
    ContextMenu,
    FilePickerAcceptTypes,
    MenuItem,
    ProjectMeta,
    ProjectSignals,
    ProjectStorage
} from "@opendaw/studio-core"
import {SearchInput} from "@/ui/components/SearchInput"
import {ThreeDots} from "@/ui/spinner/ThreeDots"
import {installScrollbars} from "@/ui/components/Scrollbars"

const className = Html.adoptStyleSheet(css, "ProjectBrowser")

type Construct = {
    service: StudioService
    lifecycle: Lifecycle
    select: Procedure<[UUID.Bytes, ProjectMeta]>
    empty?: JsxValue // rendered inside the list when there are no projects (replaces the "No projects yet." label)
}

export const ProjectBrowser = ({service, lifecycle, select, empty}: Construct) => {
    const now = new Date().getTime()
    const filter = new DefaultObservableValue("")
    return (
        <div className={className}>
            <div className="filter">
                <SearchInput lifecycle={lifecycle} model={filter} style={{gridColumn: "1 / -1"}}/>
            </div>
            <header>
                <div className="name">Name</div>
                <div className="time">Modified</div>
                <div/>
                <div/>
            </header>
            <Await factory={() => ProjectStorage.listProjects()}
                   loading={() => (<div className="loader"><ThreeDots/></div>)}
                   failure={({reason, retry}) => (
                       <div className="error" onclick={retry}>
                           {reason instanceof DOMException ? reason.name : String(reason)}
                       </div>
                   )}
                   repeat={exec => lifecycle.own(RuntimeSignal
                       .subscribe(signal => signal === ProjectSignals.StorageUpdated && exec()))}
                   success={projects => (
                       <Frag>
                           <div className="content">
                               <div className="list"
                                    onConnect={list => lifecycle.own(installScrollbars(list))}>
                                   {projects.length === 0 && isDefined(empty)
                                       ? empty
                                       : ProjectOrder.sort(projects)
                                       .map(({uuid, meta}) => {
                                           const icon: DomElement = <Icon symbol={IconSymbol.Delete}
                                                                          className="delete-icon"/>
                                           const confirmDelete = () => Dialogs.approve({
                                               headline: "Delete Project?",
                                               message: `Delete "${meta.name}"? This cannot be undone.`
                                           }).then(approved => {
                                               if (approved) {
                                                   service.deleteProject(uuid, meta).then(() => row.remove())
                                               }
                                           })
                                           const rename = async () => {
                                               const {status, error, value} = await Promises.tryCatch(
                                                   Surface.get().requestFloatingTextInput({
                                                       clientX: window.innerWidth * 0.35,
                                                       clientY: window.innerHeight * 0.25
                                                   }, meta.name))
                                               if (status === "rejected") {
                                                   if (!Errors.isAbort(error)) {console.warn(error)}
                                                   return
                                               }
                                               const renamed = await Promises.tryCatch(renameProject(service, uuid, value))
                                               if (renamed.status === "rejected") {
                                                   console.warn(renamed.error)
                                                   RuntimeNotifier.notify({message: "Rename failed.", icon: "Warning"})
                                               }
                                           }
                                           const duplicate = async () => {
                                               const copied = await Promises.tryCatch(duplicateProject(service, uuid))
                                               if (copied.status === "rejected") {
                                                   console.warn(copied.error)
                                                   RuntimeNotifier.notify({message: "Could not duplicate the project.", icon: "Warning"})
                                               } else if (copied.value !== null) {
                                                   RuntimeNotifier.notify({message: `Created '${copied.value}'.`})
                                               }
                                           }
                                           const move = (action: ProjectOrder.Action) => {
                                               const displayed = ProjectOrder.sort(projects).map(entry => UUID.toString(entry.uuid))
                                               ProjectOrder.save(ProjectOrder.arrange(displayed, UUID.toString(uuid), action))
                                               RuntimeSignal.dispatch(ProjectSignals.StorageUpdated)
                                           }
                                           const menu: DomElement = (
                                               <MenuButton root={MenuItem.root().setRuntimeChildrenProcedure(parent => parent.addMenuItem(
                                                   MenuItem.default({label: "Rename..."}).setTriggerProcedure(() => void rename()),
                                                   MenuItem.default({label: "Duplicate"}).setTriggerProcedure(() => void duplicate()),
                                                   MenuItem.default({label: "Move up"}).setTriggerProcedure(() => move("up")),
                                                   MenuItem.default({label: "Move down"}).setTriggerProcedure(() => move("down")),
                                                   MenuItem.default({label: "Move to top"}).setTriggerProcedure(() => move("top")),
                                                   MenuItem.default({label: "Delete...", separatorBefore: true})
                                                       .setTriggerProcedure(() => void confirmDelete())))}
                                                           style={{minWidth: "0"}}
                                                           appearance={{color: Colors.shadow, activeColor: Colors.cream}}>
                                                   <Icon symbol={IconSymbol.Menu}/>
                                               </MenuButton>
                                           )
                                           const timeString = TimeSpan.millis(new Date(meta.modified).getTime() - now).toUnitString()
                                           const row: HTMLElement = (
                                               <Group onInit={element => filter.catchupAndSubscribe(owner => {
                                                   element.classList.toggle("hidden", !meta.name
                                                       .toLowerCase()
                                                       .includes(owner.getValue().toLowerCase()))
                                               })}>
                                                   <div className="labels"
                                                        onclick={() => select([uuid, meta])}
                                                        onInit={element => lifecycle.own(ContextMenu.subscribe(element,
                                                            collector => collector.addItems(
                                                                MenuItem.default({label: "Show UUID"})
                                                                    .setTriggerProcedure(() => RuntimeNotifier.info({
                                                                        headline: meta.name,
                                                                        message: UUID.toString(uuid)
                                                                    })),
                                                                MenuItem.default({label: "Download File"})
                                                                    .setTriggerProcedure(async () => {
                                                                        const {status, error} = await Promises.tryCatch(
                                                                            ProjectStorage.loadProject(uuid).then(arrayBuffer =>
                                                                                Files.save(arrayBuffer, {
                                                                                    suggestedName: `${meta.name}.od`,
                                                                                    types: [FilePickerAcceptTypes.ProjectFileType]
                                                                                })))
                                                                        if (status === "rejected" && !Errors.isAbort(error)) {
                                                                            console.warn(error)
                                                                            RuntimeNotifier.notify({message: "Download failed.", icon: "Warning"})
                                                                        }
                                                                    }))))}>
                                                       <div className="name">{meta.name}</div>
                                                       <div className="time">{timeString}</div>
                                                   </div>
                                                   {menu}
                                                   {icon}
                                               </Group>
                                           )
                                           icon.onclick = (event) => {
                                               event.stopPropagation()
                                               void confirmDelete()
                                           }
                                           return row
                                       })}
                               </div>
                           </div>
                       </Frag>
                   )}/>
        </div>
    )
}