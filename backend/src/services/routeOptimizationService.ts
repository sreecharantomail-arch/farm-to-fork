import { supabase } from '../config/supabase';
import crypto from 'crypto';
import { IRoutePlan, IRouteStop } from '../models/ColdChain';

export interface RouteOptimizationInput {
  distributor_id: string;
  shipment_ids: string[];
  vehicle_capacity?: number;
  origin?: {
    address: string;
    latitude: number;
    longitude: number;
  };
}

export interface OptimizationResult {
  is_feasible: boolean;
  constraint_violations: string[];
  expiry_warnings?: string[];
  vehicle_capacity: number;
  total_weight_units: number;
  capacity_utilization_pct: number;
  baseline_distance_km: number;
  optimized_distance_km: number;
  distance_saved_km: number;
  efficiency_improvement_pct: number;
  estimated_duration_min: number;
  origin: {
    address: string;
    latitude: number;
    longitude: number;
  };
  routing_engine: string;
  distance_estimation_disclaimer: string;
  data_source_limitation?: string;
  ordered_stops: IRouteStop[];
  stops?: any[];
  metrics?: {
    baseline_distance_km: number;
    estimated_distance_km: number;
    distance_saved_km: number;
    distance_saved_pct: number;
    estimated_duration_minutes: number;
    capacity_utilization_pct: number;
  };
  google_maps_url: string;
}

export class RouteOptimizationService {
  private readonly ROAD_CIRCUITY_FACTOR = 1.30; // Empirical regional road distance multiplier over great-circle
  private readonly AVERAGE_SPEED_KMH = 40.0;     // Urban / suburban commercial fleet speed
  private readonly STOP_DWELL_MINUTES = 15;     // Unloading and receiving inspection time per stop

  /**
   * Great-circle distance between two geographic coordinates in kilometers
   */
  calculateGreatCircleDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Estimated road transit distance in kilometers
   */
  estimateRoadDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const straightLine = this.calculateGreatCircleDistanceKm(lat1, lon1, lat2, lon2);
    return Math.round(straightLine * this.ROAD_CIRCUITY_FACTOR * 100) / 100;
  }

  /**
   * Optimize delivery sequence for selected shipments
   */
  async optimizeRoute(input: RouteOptimizationInput): Promise<OptimizationResult> {
    const vehicleCapacity = Number(input.vehicle_capacity) || 500;
    const violations: string[] = [];

    if (!input.shipment_ids || input.shipment_ids.length === 0) {
      throw new Error('At least one shipment must be selected for route planning');
    }

    // 1. Fetch origin location (distributor depot)
    let origin = input.origin;
    if (!origin || !origin.latitude || !origin.longitude) {
      const { data: distUser } = await supabase
        .from('users')
        .select('name, address, latitude, longitude, city')
        .eq('id', input.distributor_id)
        .single();

      if (distUser?.latitude && distUser?.longitude) {
        origin = {
          address: distUser.address || `${distUser.city || 'Bangalore'} Distribution Hub`,
          latitude: Number(distUser.latitude),
          longitude: Number(distUser.longitude)
        };
      } else {
        // Fallback default city logistics park
        origin = {
          address: 'Central Distribution Logistics Park, Bangalore',
          latitude: 12.9716,
          longitude: 77.5946
        };
      }
    }

    // 2. Fetch shipments with product, request, and receiver details
    const { data: shipments, error: shipErr } = await supabase
      .from('shipments')
      .select(`
        id, shipment_tracking_id, batch_number, quantity, unit, status, sender_id, receiver_id,
        receiver:receiver_id(id, name, address, latitude, longitude, city),
        product:product_id(id, name, expiry_date),
        request:request_id(id, priority, required_date, product_name)
      `)
      .in('id', input.shipment_ids);

    if (shipErr || !shipments || shipments.length === 0) {
      throw new Error('Failed to load selected shipments for routing');
    }

    // Verify all shipments belong to this distributor
    const unauthorized = shipments.some(s => s.sender_id !== input.distributor_id && (s as any).distributor_id !== input.distributor_id);
    if (unauthorized) {
      throw new Error('One or more selected shipments do not belong to your distributor account');
    }

    // 3. Validate destinations and coordinates
    const validShipmentStops: Array<{
      shipment: any;
      receiver: any;
      quantity: number;
      lat: number;
      lng: number;
      address: string;
      city: string;
      priority: string;
      expiryDate: Date | null;
      isExpiryCritical: boolean;
    }> = [];

    let totalWeight = 0;

    for (const rawShipment of shipments) {
      const s: any = rawShipment;
      const receiver = s.receiver || {};
      const lat = Number(receiver.latitude);
      const lng = Number(receiver.longitude);

      if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
        violations.push(`Retailer '${receiver.name || s.receiver_id}' is missing valid geographic coordinates for destination`);
      }

      const qty = Number(s.quantity) || 0;
      totalWeight += qty;

      const product = s.product || {};
      const expiryDate = product.expiry_date ? new Date(product.expiry_date) : null;
      const isExpiryCritical = expiryDate !== null && expiryDate.getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000; // Expiring within 3 days

      const reqObj = Array.isArray(s.request) ? s.request[0] : s.request;
      validShipmentStops.push({
        shipment: s,
        receiver,
        quantity: qty,
        lat: isNaN(lat) ? origin.latitude + 0.05 : lat,
        lng: isNaN(lng) ? origin.longitude + 0.05 : lng,
        address: receiver.address || 'Retail Store Location',
        city: receiver.city || 'Bangalore',
        priority: reqObj?.priority || 'NORMAL',
        expiryDate,
        isExpiryCritical
      });
    }

    // 4. Validate Vehicle Capacity Constraint
    if (totalWeight > vehicleCapacity) {
      violations.push(
        `Total cargo weight (${totalWeight} units) exceeds vehicle capacity (${vehicleCapacity} units) by ${totalWeight - vehicleCapacity} units`
      );
    }

    const capacityUtilization = Math.round((totalWeight / vehicleCapacity) * 1000) / 10;

    // 5. Compute Baseline Distance (Original FIFO order)
    let baselineDistance = 0;
    let currLat = origin.latitude;
    let currLng = origin.longitude;

    for (const stop of validShipmentStops) {
      baselineDistance += this.estimateRoadDistanceKm(currLat, currLng, stop.lat, stop.lng);
      currLat = stop.lat;
      currLng = stop.lng;
    }
    baselineDistance = Math.round(baselineDistance * 100) / 100;

    // 6. Constrained Nearest-Neighbor Algorithm with Expiry/Priority Heuristic & 2-Opt
    // High priority or critical expiry shipments are weighted to be visited earlier
    const unvisited = [...validShipmentStops];
    const optimizedOrder: typeof validShipmentStops = [];
    currLat = origin.latitude;
    currLng = origin.longitude;

    while (unvisited.length > 0) {
      let bestIndex = -1;
      let bestScore = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const item = unvisited[i];
        const dist = this.estimateRoadDistanceKm(currLat, currLng, item.lat, item.lng);
        // Expiry priority discount: if expiry-critical, prioritize in distance scoring
        const urgencyDiscount = item.isExpiryCritical ? 0.6 : item.priority === 'URGENT' ? 0.75 : 1.0;
        const score = dist * urgencyDiscount;

        if (score < bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      const [nextStop] = unvisited.splice(bestIndex, 1);
      optimizedOrder.push(nextStop);
      currLat = nextStop.lat;
      currLng = nextStop.lng;
    }

    // 7. Apply 2-Opt Heuristic Improvement (if 4 or more stops)
    if (optimizedOrder.length >= 4) {
      let improved = true;
      let iterations = 0;

      while (improved && iterations < 50) {
        improved = false;
        iterations++;

        for (let i = 0; i < optimizedOrder.length - 1; i++) {
          for (let k = i + 1; k < optimizedOrder.length; k++) {
            // Check if reversing subsegment [i...k] shortens distance
            const prevLat = i === 0 ? origin.latitude : optimizedOrder[i - 1].lat;
            const prevLng = i === 0 ? origin.longitude : optimizedOrder[i - 1].lng;

            const nextLat = k === optimizedOrder.length - 1 ? optimizedOrder[k].lat : optimizedOrder[k + 1].lat;
            const nextLng = k === optimizedOrder.length - 1 ? optimizedOrder[k].lng : optimizedOrder[k + 1].lng;

            const dCurrent =
              this.estimateRoadDistanceKm(prevLat, prevLng, optimizedOrder[i].lat, optimizedOrder[i].lng) +
              this.estimateRoadDistanceKm(optimizedOrder[k].lat, optimizedOrder[k].lng, nextLat, nextLng);

            const dReversed =
              this.estimateRoadDistanceKm(prevLat, prevLng, optimizedOrder[k].lat, optimizedOrder[k].lng) +
              this.estimateRoadDistanceKm(optimizedOrder[i].lat, optimizedOrder[i].lng, nextLat, nextLng);

            if (dReversed < dCurrent - 0.05) {
              // Reverse sub-array between i and k
              const reversedSegment = optimizedOrder.slice(i, k + 1).reverse();
              optimizedOrder.splice(i, reversedSegment.length, ...reversedSegment);
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
      }
    }

    // 8. Build Ordered Stops with ETAs and Cumulative Distances
    const finalStops: IRouteStop[] = [];
    let optDistance = 0;
    let optDurationMinutes = 0;
    currLat = origin.latitude;
    currLng = origin.longitude;

    for (let i = 0; i < optimizedOrder.length; i++) {
      const item = optimizedOrder[i];
      const legDist = this.estimateRoadDistanceKm(currLat, currLng, item.lat, item.lng);
      optDistance += legDist;

      const travelTimeMinutes = Math.round((legDist / this.AVERAGE_SPEED_KMH) * 60);
      optDurationMinutes += travelTimeMinutes + this.STOP_DWELL_MINUTES;

      finalStops.push({
        stop_number: i + 1,
        shipment_id: item.shipment.id,
        tracking_id: item.shipment.shipment_tracking_id,
        batch_number: item.shipment.batch_number,
        product_name: item.shipment.request?.product_name || item.shipment.product?.name || 'Produce Batch',
        retailer_id: item.receiver.id || item.shipment.receiver_id,
        retailer_name: item.receiver.name || 'Retailer Store',
        address: item.address,
        city: item.city,
        latitude: item.lat,
        longitude: item.lng,
        quantity: item.quantity,
        unit: item.shipment.unit || 'units',
        leg_distance_km: legDist,
        cumulative_distance_km: Math.round(optDistance * 100) / 100,
        estimated_travel_minutes: travelTimeMinutes,
        estimated_arrival_minutes_from_depot: optDurationMinutes,
        expiry_date: item.expiryDate ? item.expiryDate.toISOString().split('T')[0] : null,
        is_expiry_critical: item.isExpiryCritical
      });

      currLat = item.lat;
      currLng = item.lng;
    }

    optDistance = Math.round(optDistance * 100) / 100;
    const distanceSaved = Math.max(0, Math.round((baselineDistance - optDistance) * 100) / 100);
    const efficiencyImprovement = baselineDistance > 0 ? Math.round((distanceSaved / baselineDistance) * 1000) / 10 : 0;

    // 9. Generate Google Maps Direct Navigation Link
    let googleMapsUrl = '';
    if (finalStops.length > 0) {
      const destStop = finalStops[finalStops.length - 1];
      const waypoints = finalStops
        .slice(0, -1)
        .map(s => `${s.latitude},${s.longitude}`)
        .join('|');

      googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${destStop.latitude},${destStop.longitude}${
        waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ''
      }`;
    }

    // 10. Expiry warnings & FEFO notices
    const expiryWarnings: string[] = [];
    for (const stop of validShipmentStops) {
      if (stop.isExpiryCritical && stop.expiryDate) {
        const daysLeft = Math.max(0, Math.round((stop.expiryDate.getTime() - Date.now()) / (24 * 3600 * 1000)));
        expiryWarnings.push(
          `Shipment ${stop.shipment.shipment_tracking_id} (${stop.shipment.product?.name || 'Produce'}) expires in ${daysLeft} days (${stop.expiryDate.toISOString().split('T')[0]}) - prioritized for delivery`
        );
      }
    }

    // 11. Build UI Display Stops Sequence: Origin -> Deliveries -> Return
    const returnLegDist = finalStops.length > 0 ? this.estimateRoadDistanceKm(currLat, currLng, origin.latitude, origin.longitude) : 0;
    const returnTravelTimeMinutes = Math.round((returnLegDist / this.AVERAGE_SPEED_KMH) * 60);
    const totalDurationWithReturn = optDurationMinutes + returnTravelTimeMinutes;

    const displayStops = [
      {
        stop_number: 1,
        is_origin: true,
        address: origin.address,
        retailer_name: origin.address,
        distance_from_previous_km: 0,
        leg_distance_km: 0,
        estimated_arrival: 'Depot Departure (0m)',
        latitude: origin.latitude,
        longitude: origin.longitude
      },
      ...finalStops.map(s => ({
        ...s,
        stop_number: s.stop_number + 1,
        is_origin: false,
        distance_from_previous_km: s.leg_distance_km,
        quantity_to_deliver: s.quantity,
        estimated_arrival: `+${s.estimated_arrival_minutes_from_depot}m from depot`
      })),
      {
        stop_number: finalStops.length + 2,
        is_origin: true,
        address: origin.address,
        retailer_name: `Return: ${origin.address}`,
        distance_from_previous_km: returnLegDist,
        leg_distance_km: returnLegDist,
        estimated_arrival: `+${totalDurationWithReturn}m (Route Complete)`,
        latitude: origin.latitude,
        longitude: origin.longitude
      }
    ];

    const disclaimer =
      'Distances are approximated via Haversine great-circle geographic distance with 1.30x regional road circuity factor. Actual road navigation and traffic conditions may vary.';

    return {
      is_feasible: violations.length === 0,
      constraint_violations: violations,
      expiry_warnings: expiryWarnings,
      vehicle_capacity: vehicleCapacity,
      total_weight_units: totalWeight,
      capacity_utilization_pct: capacityUtilization,
      baseline_distance_km: baselineDistance,
      optimized_distance_km: optDistance,
      distance_saved_km: distanceSaved,
      efficiency_improvement_pct: efficiencyImprovement,
      estimated_duration_min: optDurationMinutes,
      origin,
      routing_engine: 'CONSTRAINED_NEAREST_NEIGHBOR_2OPT',
      distance_estimation_disclaimer: disclaimer,
      data_source_limitation: disclaimer,
      ordered_stops: finalStops,
      stops: displayStops,
      metrics: {
        baseline_distance_km: baselineDistance,
        estimated_distance_km: optDistance,
        distance_saved_km: distanceSaved,
        distance_saved_pct: efficiencyImprovement,
        estimated_duration_minutes: optDurationMinutes,
        capacity_utilization_pct: capacityUtilization
      },
      google_maps_url: googleMapsUrl
    };
  }

  /**
   * Persist a generated route plan to the database
   */
  async saveRoutePlan(planData: Omit<IRoutePlan, 'id' | 'created_at' | 'updated_at'>): Promise<IRoutePlan> {
    const { data: plan, error } = await supabase
      .from('route_plans')
      .insert({
        distributor_id: planData.distributor_id,
        plan_name: planData.plan_name,
        status: planData.status || 'PLANNED',
        vehicle_capacity: planData.vehicle_capacity,
        total_weight_units: planData.total_weight_units,
        capacity_utilization_pct: planData.capacity_utilization_pct,
        total_distance_km: planData.total_distance_km,
        baseline_distance_km: planData.baseline_distance_km,
        distance_saved_km: planData.distance_saved_km,
        efficiency_improvement_pct: planData.efficiency_improvement_pct,
        estimated_duration_min: planData.estimated_duration_min,
        origin_address: planData.origin_address,
        origin_lat: planData.origin_lat,
        origin_lng: planData.origin_lng,
        routing_engine: planData.routing_engine || 'CONSTRAINED_NEAREST_NEIGHBOR_2OPT',
        shipment_ids: planData.shipment_ids,
        ordered_stops: planData.ordered_stops,
        notes: planData.notes || null
      })
      .select()
      .single();

    if (error || !plan) {
      throw new Error(`Failed to save route plan: ${error?.message || 'Database error'}`);
    }

    return plan;
  }

  /**
   * Dispatch an existing route plan
   */
  async dispatchRoutePlan(planId: string, distributorId: string): Promise<IRoutePlan> {
    const { data: plan, error: fetchErr } = await supabase
      .from('route_plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (fetchErr || !plan) {
      throw new Error('Route plan not found');
    }

    if (plan.distributor_id !== distributorId) {
      throw new Error('You do not own this route plan');
    }

    const dispatchedAt = new Date().toISOString();

    const { data: updatedPlan, error: updateErr } = await supabase
      .from('route_plans')
      .update({
        status: 'DISPATCHED',
        dispatched_at: dispatchedAt,
        updated_at: dispatchedAt
      })
      .eq('id', planId)
      .select()
      .single();

    if (updateErr || !updatedPlan) {
      throw new Error('Failed to update route plan status');
    }

    // Insert Event Outbox for Route Dispatch
    await supabase.from('event_outbox').insert({
      event_id: crypto.randomUUID(),
      event_type: 'ROUTE_DISPATCHED',
      topic: 'logistics-events',
      payload: {
        route_plan_id: plan.id,
        plan_name: plan.plan_name,
        distributor_id: distributorId,
        stops_count: Array.isArray(plan.ordered_stops) ? plan.ordered_stops.length : 0,
        total_distance_km: plan.total_distance_km,
        dispatched_at: dispatchedAt
      }
    });

    return updatedPlan;
  }

  /**
   * List route plans for a distributor
   */
  async getRoutePlans(distributorId: string): Promise<IRoutePlan[]> {
    const { data: plans, error } = await supabase
      .from('route_plans')
      .select('*')
      .eq('distributor_id', distributorId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(`Failed to fetch route plans: ${error.message}`);
    }
    return plans || [];
  }
}

export const routeOptimizationService = new RouteOptimizationService();
