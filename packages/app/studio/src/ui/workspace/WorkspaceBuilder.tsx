import {Workspace} from "@/ui/workspace/Workspace.ts"
import {PanelPlaceholder} from "@/ui/workspace/PanelPlaceholder.tsx"
import {PanelResizer} from "@/ui/workspace/PanelResizer.tsx"
import {PanelContents} from "@/ui/workspace/PanelContents.tsx"
import {ContentGlue} from "@/ui/workspace/ContentGlue.ts"
import {AxisProperty} from "@/ui/workspace/AxisProperty.ts"
import {isDefined, Iterables, Lifecycle, Nullable, ObservableValue, Unhandled} from "@opendaw/lib-std"
import {RoomAwareness} from "@/service/RoomAwareness"
import {Html} from "@opendaw/lib-dom"
import {appendChildren, createElement} from "@opendaw/lib-jsx"

export namespace WorkspaceBuilder {
    export const buildScreen = (lifecycle: Lifecycle,
                                panelContents: PanelContents,
                                element: HTMLElement,
                                screenKey: Nullable<Workspace.ScreenKeys>,
                                roomAwareness: ObservableValue<Nullable<RoomAwareness>>) => {
        Html.empty(element)
        if (screenKey === null) {return}
        const isEveryClosed = (content: Workspace.Content): boolean =>
            content.type === "panel" ? panelContents.isClosed(content) : content.contents.every(isEveryClosed)
        // Phone fork: when every panel of a column is minimized (Timeline, Editor, Devices) the column shrinks to
        // just its title bars, and the panels beside it (the Mixer) take all the space that is left, without the
        // usual maximum width.
        const CollapsedSize = 132
        const rebalance = (glue: ContentGlue, siblings: ReadonlyArray<ContentGlue>, orientation: Workspace.Orientation) => {
            const property = AxisProperty[orientation]
            const othersOpen = siblings.some(other => other !== glue
                && other.content.constrains.type === "flex" && !isEveryClosed(other.content))
            const collapsed = isEveryClosed(glue.content) && othersOpen
            if (collapsed) {
                glue.element.style.flexGrow = "0"
                glue.element.style[property.minStyle] = glue.element.style[property.maxStyle] = `${CollapsedSize}px`
            } else {
                glue.element.style[property.minStyle] = ""
                glue.element.style[property.maxStyle] = ""
            }
            const open = siblings.filter(({content}) => content.constrains.type === "flex"
                && !(content === glue.content ? collapsed : isEveryClosed(content)))
            open.forEach(({content, element}) => {
                const {constrains} = content
                if (constrains.type !== "flex") {return}
                element.style.flexGrow = open.length === 1 ? "1" : constrains.flex.toString()
                if (content.type === "panel") {
                    element.style[property.maxStyle] =
                        `${collapsed ? Number.MAX_SAFE_INTEGER : (constrains.maxSize ?? Number.MAX_SAFE_INTEGER)}px`
                }
            })
        }
        const build = (container: HTMLElement,
                       siblings: ContentGlue[],
                       content: Workspace.Content,
                       next: Nullable<Workspace.Content>,
                       orientation: Workspace.Orientation) => {
            const element: HTMLElement = (() => {
                if (content.type === "panel") {
                    return (
                        <PanelPlaceholder lifecycle={lifecycle}
                                          orientation={orientation}
                                          siblings={siblings}
                                          panelContents={panelContents}
                                          panelState={content}
                                          roomAwareness={roomAwareness}/>
                    )
                } else if (content.type === "layout") {
                    const section = (
                        <section className={Html.buildClassList("workspace", content.orientation)}>
                            <div className="fill"/>
                        </section>
                    )
                    const children: Array<ContentGlue> = []
                    for (const [curr, next] of Iterables.pairWise(content.contents)) {
                        build(section, children, curr, next, content.orientation)
                    }
                    return section
                } else {
                    return Unhandled(content)
                }
            })()
            const glue: ContentGlue = {element, content}
            siblings.push(glue)
            if (content.type === "layout" && orientation === "horizontal") {
                lifecycle.own(panelContents.subscribeLayoutChange(() => rebalance(glue, siblings, orientation)))
                rebalance(glue, siblings, orientation)
            }
            appendChildren(container, element)
            if (content.constrains.type === "flex" && isDefined(next) && next.constrains.type === "flex") {
                container.appendChild(
                    <PanelResizer lifecycle={lifecycle}
                                  panelContents={panelContents}
                                  target={element}
                                  orientation={orientation}
                                  siblings={siblings}/>
                )
            }
        }
        build(element, [], Workspace.Default[screenKey].content, null, "vertical")
    }
}