import { randomUUID } from 'node:crypto';
import type { Authority, AuthorityRequest } from '../server/authority';
import type { CityCommand } from '../sim/commands';
import type { Rotation, ActionResult, City, World } from '../sim/types';
import type { AgentGame, AgentView } from './game';

export class AuthorityGame implements AgentGame {
  constructor(private readonly authority: Authority, private readonly credential: string) {}

  view(): AgentView {
    const world = this.authority.snapshot();
    return { world, city: this.ownedCity(world) };
  }

  async submit(command: CityCommand): Promise<ActionResult> {
    const world = this.authority.snapshot();
    const city = this.ownedCity(world);
    if (!city) return { ok: false, reason: 'Found your city with found_city before building on it.' };
    return this.request({ kind: 'command', cityId: city.id, command });
  }

  async claim(x: number, z: number, rotation: Rotation): Promise<ActionResult> {
    return this.request({ kind: 'claim', x, z, rotation });
  }

  private ownedCity(world: World): City | null {
    const session = this.authority.authenticate(this.credential);
    if (!session) return null;
    const owned = new Set(session.ownedCityIds);
    return world.cities.find((city) => owned.has(city.id)) ?? null;
  }

  private request(operation: AuthorityRequest): ActionResult {
    const session = this.authority.authenticate(this.credential);
    if (!session) return { ok: false, reason: 'This agent is no longer admitted to the archipelago.' };
    if (session.nextSeq === null) return { ok: false, reason: 'This agent has exhausted its sequence and must be admitted again.' };
    const outcome = this.authority.submit(this.credential, session.nextSeq, randomUUID(), operation);
    return { ok: outcome.ok, reason: outcome.reason };
  }
}
