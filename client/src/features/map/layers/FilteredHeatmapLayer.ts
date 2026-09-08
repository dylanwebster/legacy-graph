import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { UpdateParameters } from '@deck.gl/core';

/** HeatmapLayer + working DataFilterExtension support (deck.gl 9.3).
 *
 *  Upstream HeatmapLayer misses three things when a DataFilterExtension is
 *  attached, all because its weight aggregation runs in an internal
 *  TextureTransform rather than a normal layer draw:
 *
 *  1. The dataFilter shader module is compiled into the weights transform
 *     (via getShaders), but its uniform block is never populated — the
 *     extension only sets uniforms during layer draws. Left at defaults, the
 *     aggregation is unfiltered. Fix: push `this.props` through the module's
 *     shaderInputs before every weights run.
 *
 *  2. A `filterRange` change never marks the weight texture dirty —
 *     aggregation-dirty prop comparison ignores extension props (they land in
 *     the layer's ignoreProps set) — so the glow stays frozen while pins
 *     filter correctly. Fix: flag isWeightMapDirty on filterRange change
 *     before super.updateState consumes the flag.
 *
 *  3. The extension registers `filterValues` with `stepMode: 'dynamic'`,
 *     which resolves to **'instance'** when getBufferLayouts() is called
 *     without a model hint (deck.gl core attribute.js) — and that's exactly
 *     how _createWeightsTransform calls it. The weights transform draws one
 *     NON-instanced vertex per event, so an instance-stepped attribute never
 *     advances: every vertex reads event[0]'s filter value and the whole
 *     texture passes or fails as one. Fix: pin the attribute's stepMode to
 *     'vertex' — this layer never draws instanced (NON_INSTANCED_MODEL).
 *
 *  Re-aggregation cost per filterRange change is one GPU point-draw over the
 *  (unchanged, already-uploaded) attribute buffers — no CPU accessor loop.
 */
export class FilteredHeatmapLayer<DataT, ExtraPropsT extends object> extends HeatmapLayer<
    DataT,
    ExtraPropsT
> {
    static layerName = 'FilteredHeatmapLayer';

    updateState(opts: UpdateParameters<this>): void {
        // Pin per-vertex stepping before super's first dataChanged pass
        // recreates the weights transform (which bakes the buffer layout).
        const filterValues = this.getAttributeManager()?.getAttributes().filterValues as
            | { settings: { stepMode?: string } }
            | undefined;
        if (filterValues && filterValues.settings.stepMode !== 'vertex') {
            filterValues.settings.stepMode = 'vertex';
        }
        const { filterRange } = opts.props as { filterRange?: unknown };
        const { filterRange: oldFilterRange } = opts.oldProps as { filterRange?: unknown };
        if (this.state && filterRange !== oldFilterRange) {
            this.state.isWeightMapDirty = true;
        }
        super.updateState(opts);
    }

    _updateWeightmap(): void {
        const { weightsTransform } = this.state;
        // getUniforms of the dataFilter module reads the full layer props
        // (it bails unless `extensions` is present on the object).
        weightsTransform?.model.shaderInputs.setProps({ dataFilter: this.props });
        super._updateWeightmap();
    }
}
