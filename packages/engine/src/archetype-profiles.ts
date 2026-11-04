// File generato da `pnpm data:import`: profili degli archetipi ricavati dai giocatori reali.
// Contiene solo medie e dispersioni, nessun dato dei singoli giocatori.
import type { ArchetypeProfile } from './profiles.ts';

export const ARCHETYPE_PROFILES: readonly ArchetypeProfile[] = [
  {
    archetype: 'Ala interna',
    count: 67,
    roles: {
      PF: 67,
    },
    secondaryRoles: {
      SF: 50,
      C: 17,
    },
    heightCm: {
      mean: 207.8,
      sd: 2.6,
    },
    weightKg: {
      mean: 103.7,
      sd: 7.9,
    },
    wingspanRatio: 1.073,
    fields: {
      'ratings.closeShot': {
        mean: 72.5,
        sd: 4.1,
        loading: 0.8,
      },
      'ratings.layup': {
        mean: 65,
        sd: 3.4,
        loading: 0.8,
      },
      'ratings.drivingDunk': {
        mean: 75.3,
        sd: 3.8,
        loading: 0.8,
      },
      'ratings.standingDunk': {
        mean: 60.9,
        sd: 5.2,
        loading: 0.7,
      },
      'ratings.postControl': {
        mean: 62.2,
        sd: 4.1,
        loading: 0.7,
      },
      'ratings.hook': {
        mean: 51.2,
        sd: 4.9,
        loading: 0.7,
      },
      'ratings.postFade': {
        mean: 50.6,
        sd: 4.7,
        loading: 0.6,
      },
      'ratings.drawFoul': {
        mean: 63.3,
        sd: 4.4,
        loading: 0.7,
      },
      'ratings.midRange': {
        mean: 60.3,
        sd: 4.3,
        loading: 0.7,
      },
      'ratings.threePoint': {
        mean: 55.3,
        sd: 4.5,
        loading: 0.6,
      },
      'ratings.pullUp': {
        mean: 52.1,
        sd: 5.1,
        loading: 0.6,
      },
      'ratings.freeThrow': {
        mean: 64.6,
        sd: 5.1,
        loading: 0.7,
      },
      'ratings.ballHandle': {
        mean: 51.7,
        sd: 5.2,
        loading: 0.7,
      },
      'ratings.speedWithBall': {
        mean: 59,
        sd: 4.8,
        loading: 0.7,
      },
      'ratings.passAccuracy': {
        mean: 61.8,
        sd: 4.6,
        loading: 0.5,
      },
      'ratings.passVision': {
        mean: 57.3,
        sd: 4.6,
        loading: 0.8,
      },
      'ratings.hands': {
        mean: 69.5,
        sd: 4.4,
        loading: 0.6,
      },
      'ratings.perimeterDefense': {
        mean: 57.9,
        sd: 4.2,
        loading: 0.8,
      },
      'ratings.interiorDefense': {
        mean: 73.2,
        sd: 3.4,
        loading: 0.7,
      },
      'ratings.steal': {
        mean: 54.7,
        sd: 4.4,
        loading: 0.5,
      },
      'ratings.block': {
        mean: 70.2,
        sd: 3.6,
        loading: 0.5,
      },
      'ratings.helpDefense': {
        mean: 65.9,
        sd: 3.6,
        loading: 0.8,
      },
      'ratings.passLaneReading': {
        mean: 58.4,
        sd: 4.8,
        loading: 0.6,
      },
      'ratings.offensiveRebound': {
        mean: 63.2,
        sd: 4,
        loading: 0.7,
      },
      'ratings.defensiveRebound': {
        mean: 70.6,
        sd: 4.4,
        loading: 0.7,
      },
      'ratings.speed': {
        mean: 64.6,
        sd: 5.3,
        loading: 0.7,
      },
      'ratings.agility': {
        mean: 65.9,
        sd: 5.2,
        loading: 0.7,
      },
      'ratings.strength': {
        mean: 75.9,
        sd: 4.7,
        loading: 0.7,
      },
      'ratings.vertical': {
        mean: 75.4,
        sd: 4.4,
        loading: 0.7,
      },
      'ratings.stamina': {
        mean: 71.7,
        sd: 4.7,
        loading: 0.7,
      },
      'ratings.hustle': {
        mean: 74.9,
        sd: 5.2,
        loading: 0.7,
      },
      'ratings.offensiveIQ': {
        mean: 70.2,
        sd: 4.8,
        loading: 0.8,
      },
      'ratings.defensiveIQ': {
        mean: 65.5,
        sd: 5,
        loading: 0.6,
      },
      'ratings.clutch': {
        mean: 69,
        sd: 3.6,
        loading: 0.7,
      },
      'ratings.leadership': {
        mean: 60.1,
        sd: 3.5,
        loading: 0.8,
      },
      'tendencies.three': {
        mean: 48.4,
        sd: 5.9,
        loading: 0,
      },
      'tendencies.midRange': {
        mean: 43.5,
        sd: 5.8,
        loading: 0.3,
      },
      'tendencies.drive': {
        mean: 62.6,
        sd: 5.5,
        loading: 0,
      },
      'tendencies.post': {
        mean: 63.9,
        sd: 5.6,
        loading: 0.1,
      },
      'tendencies.isolation': {
        mean: 49.3,
        sd: 5.2,
        loading: 0.1,
      },
      'tendencies.pickAndRoll': {
        mean: 17.1,
        sd: 6.8,
        loading: 0,
      },
      'tendencies.cut': {
        mean: 63.7,
        sd: 5.4,
        loading: 0,
      },
      'tendencies.dunkOverLayup': {
        mean: 69,
        sd: 5.7,
        loading: 0.2,
      },
      'tendencies.pullUpOverPass': {
        mean: 44.1,
        sd: 6.2,
        loading: 0.2,
      },
      'tendencies.drawFoul': {
        mean: 55,
        sd: 5.9,
        loading: 0.2,
      },
      'tendencies.steal': {
        mean: 54.8,
        sd: 5.7,
        loading: 0.3,
      },
      'tendencies.block': {
        mean: 61.1,
        sd: 6.1,
        loading: 0.1,
      },
      'tendencies.contest': {
        mean: 73.8,
        sd: 6.6,
        loading: 0.1,
      },
      'tendencies.hardFoul': {
        mean: 46.6,
        sd: 5.6,
        loading: 0,
      },
      'hidden.potential': {
        mean: 79.7,
        sd: 4,
        loading: 0.4,
      },
      'hidden.workEthic': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
      'hidden.offensiveConsistency': {
        mean: 64.1,
        sd: 3.9,
        loading: 0.8,
      },
      'hidden.defensiveConsistency': {
        mean: 69.1,
        sd: 2,
        loading: 0.8,
      },
      'hidden.durabilityBack': {
        mean: 78.3,
        sd: 4.1,
        loading: 0,
      },
      'hidden.durabilityKnees': {
        mean: 78.3,
        sd: 4.1,
        loading: 0,
      },
      'hidden.durabilityAnkles': {
        mean: 78.3,
        sd: 4.1,
        loading: 0,
      },
      'hidden.durabilityFeet': {
        mean: 78.3,
        sd: 4.1,
        loading: 0,
      },
      'hidden.durabilityShoulders': {
        mean: 78.3,
        sd: 4.1,
        loading: 0,
      },
      'hidden.character': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
    },
  },
  {
    archetype: 'Ala versatile',
    count: 104,
    roles: {
      SF: 104,
    },
    secondaryRoles: {
      PF: 104,
    },
    heightCm: {
      mean: 200.6,
      sd: 2.6,
    },
    weightKg: {
      mean: 100.4,
      sd: 6,
    },
    wingspanRatio: 1.065,
    fields: {
      'ratings.closeShot': {
        mean: 67.5,
        sd: 4.2,
        loading: 0.6,
      },
      'ratings.layup': {
        mean: 66.9,
        sd: 4.4,
        loading: 0.7,
      },
      'ratings.drivingDunk': {
        mean: 66.6,
        sd: 3.7,
        loading: 0.7,
      },
      'ratings.standingDunk': {
        mean: 37.3,
        sd: 4.5,
        loading: 0.5,
      },
      'ratings.postControl': {
        mean: 42.3,
        sd: 4.4,
        loading: 0.6,
      },
      'ratings.hook': {
        mean: 31.9,
        sd: 4.7,
        loading: 0.6,
      },
      'ratings.postFade': {
        mean: 35.7,
        sd: 2.7,
        loading: 0.6,
      },
      'ratings.drawFoul': {
        mean: 61.3,
        sd: 4,
        loading: 0.6,
      },
      'ratings.midRange': {
        mean: 65.7,
        sd: 4.5,
        loading: 0.7,
      },
      'ratings.threePoint': {
        mean: 67.7,
        sd: 3.7,
        loading: 0.6,
      },
      'ratings.pullUp': {
        mean: 61.6,
        sd: 4.1,
        loading: 0.7,
      },
      'ratings.freeThrow': {
        mean: 69.4,
        sd: 4.2,
        loading: 0.5,
      },
      'ratings.ballHandle': {
        mean: 65.6,
        sd: 4.3,
        loading: 0.6,
      },
      'ratings.speedWithBall': {
        mean: 66.8,
        sd: 4.3,
        loading: 0.5,
      },
      'ratings.passAccuracy': {
        mean: 65.4,
        sd: 3.9,
        loading: 0.6,
      },
      'ratings.passVision': {
        mean: 61,
        sd: 3,
        loading: 0.5,
      },
      'ratings.hands': {
        mean: 72.6,
        sd: 4.3,
        loading: 0.6,
      },
      'ratings.perimeterDefense': {
        mean: 68,
        sd: 3.4,
        loading: 0.5,
      },
      'ratings.interiorDefense': {
        mean: 60.4,
        sd: 3.2,
        loading: 0.5,
      },
      'ratings.steal': {
        mean: 66.7,
        sd: 3.1,
        loading: 0.4,
      },
      'ratings.block': {
        mean: 50.7,
        sd: 3.8,
        loading: 0.5,
      },
      'ratings.helpDefense': {
        mean: 62.5,
        sd: 3.7,
        loading: 0.7,
      },
      'ratings.passLaneReading': {
        mean: 64.8,
        sd: 3.7,
        loading: 0.5,
      },
      'ratings.offensiveRebound': {
        mean: 45.1,
        sd: 4.2,
        loading: 0.5,
      },
      'ratings.defensiveRebound': {
        mean: 62.5,
        sd: 4.1,
        loading: 0.6,
      },
      'ratings.speed': {
        mean: 71.6,
        sd: 4.3,
        loading: 0.6,
      },
      'ratings.agility': {
        mean: 72.6,
        sd: 4.5,
        loading: 0.7,
      },
      'ratings.strength': {
        mean: 67.2,
        sd: 4.5,
        loading: 0.7,
      },
      'ratings.vertical': {
        mean: 74.7,
        sd: 3.6,
        loading: 0.6,
      },
      'ratings.stamina': {
        mean: 74.6,
        sd: 4.2,
        loading: 0.7,
      },
      'ratings.hustle': {
        mean: 73.5,
        sd: 4.3,
        loading: 0.6,
      },
      'ratings.offensiveIQ': {
        mean: 67.5,
        sd: 3.4,
        loading: 0.6,
      },
      'ratings.defensiveIQ': {
        mean: 67.3,
        sd: 4.1,
        loading: 0.7,
      },
      'ratings.clutch': {
        mean: 64.6,
        sd: 2.1,
        loading: 0.7,
      },
      'ratings.leadership': {
        mean: 57,
        sd: 2.1,
        loading: 0.6,
      },
      'tendencies.three': {
        mean: 70.5,
        sd: 7,
        loading: 0.1,
      },
      'tendencies.midRange': {
        mean: 57.6,
        sd: 5.8,
        loading: 0,
      },
      'tendencies.drive': {
        mean: 63.7,
        sd: 5.9,
        loading: 0.1,
      },
      'tendencies.post': {
        mean: 41.5,
        sd: 6.7,
        loading: 0,
      },
      'tendencies.isolation': {
        mean: 57,
        sd: 5.8,
        loading: 0.2,
      },
      'tendencies.pickAndRoll': {
        mean: 34,
        sd: 5.4,
        loading: 0.1,
      },
      'tendencies.cut': {
        mean: 61.1,
        sd: 5.3,
        loading: 0.1,
      },
      'tendencies.dunkOverLayup': {
        mean: 53.1,
        sd: 5.9,
        loading: 0.1,
      },
      'tendencies.pullUpOverPass': {
        mean: 63.9,
        sd: 5.6,
        loading: 0,
      },
      'tendencies.drawFoul': {
        mean: 53.3,
        sd: 5.6,
        loading: 0,
      },
      'tendencies.steal': {
        mean: 64.1,
        sd: 5.4,
        loading: 0,
      },
      'tendencies.block': {
        mean: 41.3,
        sd: 6.1,
        loading: 0,
      },
      'tendencies.contest': {
        mean: 67.7,
        sd: 6.7,
        loading: 0,
      },
      'tendencies.hardFoul': {
        mean: 39.8,
        sd: 5.5,
        loading: 0,
      },
      'hidden.potential': {
        mean: 77.1,
        sd: 4.3,
        loading: 0.2,
      },
      'hidden.workEthic': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
      'hidden.offensiveConsistency': {
        mean: 61.5,
        sd: 2.2,
        loading: 0.9,
      },
      'hidden.defensiveConsistency': {
        mean: 67.7,
        sd: 2,
        loading: 0.8,
      },
      'hidden.durabilityBack': {
        mean: 79.2,
        sd: 3.2,
        loading: 0.1,
      },
      'hidden.durabilityKnees': {
        mean: 79.2,
        sd: 3.2,
        loading: 0.1,
      },
      'hidden.durabilityAnkles': {
        mean: 79.1,
        sd: 3.9,
        loading: 0.1,
      },
      'hidden.durabilityFeet': {
        mean: 79,
        sd: 4.3,
        loading: 0.1,
      },
      'hidden.durabilityShoulders': {
        mean: 79.2,
        sd: 3.2,
        loading: 0.1,
      },
      'hidden.character': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
    },
  },
  {
    archetype: 'Centro di area',
    count: 59,
    roles: {
      C: 59,
    },
    secondaryRoles: {
      PF: 59,
    },
    heightCm: {
      mean: 211,
      sd: 4.8,
    },
    weightKg: {
      mean: 113.5,
      sd: 7.2,
    },
    wingspanRatio: 1.075,
    fields: {
      'ratings.closeShot': {
        mean: 76,
        sd: 4.6,
        loading: 0.7,
      },
      'ratings.layup': {
        mean: 58.6,
        sd: 4.1,
        loading: 0.6,
      },
      'ratings.drivingDunk': {
        mean: 66.6,
        sd: 3.4,
        loading: 0.6,
      },
      'ratings.standingDunk': {
        mean: 79.3,
        sd: 5,
        loading: 0.7,
      },
      'ratings.postControl': {
        mean: 69.5,
        sd: 2.1,
        loading: 0.7,
      },
      'ratings.hook': {
        mean: 62,
        sd: 4.2,
        loading: 0.7,
      },
      'ratings.postFade': {
        mean: 51.8,
        sd: 2.7,
        loading: 0.7,
      },
      'ratings.drawFoul': {
        mean: 61.9,
        sd: 3.5,
        loading: 0.6,
      },
      'ratings.midRange': {
        mean: 50.2,
        sd: 4,
        loading: 0.7,
      },
      'ratings.threePoint': {
        mean: 41,
        sd: 3.1,
        loading: 0.7,
      },
      'ratings.pullUp': {
        mean: 41.1,
        sd: 3.9,
        loading: 0.7,
      },
      'ratings.freeThrow': {
        mean: 58,
        sd: 3.6,
        loading: 0.4,
      },
      'ratings.ballHandle': {
        mean: 38,
        sd: 4.7,
        loading: 0.7,
      },
      'ratings.speedWithBall': {
        mean: 43.2,
        sd: 4.9,
        loading: 0.7,
      },
      'ratings.passAccuracy': {
        mean: 64.3,
        sd: 5.4,
        loading: 0.5,
      },
      'ratings.passVision': {
        mean: 52.1,
        sd: 2.3,
        loading: 0.6,
      },
      'ratings.hands': {
        mean: 73.1,
        sd: 4.1,
        loading: 0.6,
      },
      'ratings.perimeterDefense': {
        mean: 42.6,
        sd: 4.2,
        loading: 0.7,
      },
      'ratings.interiorDefense': {
        mean: 77.2,
        sd: 3.4,
        loading: 0.7,
      },
      'ratings.steal': {
        mean: 43,
        sd: 4.9,
        loading: 0.5,
      },
      'ratings.block': {
        mean: 79.1,
        sd: 4.6,
        loading: 0.5,
      },
      'ratings.helpDefense': {
        mean: 72.3,
        sd: 3.9,
        loading: 0.7,
      },
      'ratings.passLaneReading': {
        mean: 52.4,
        sd: 4.8,
        loading: 0.4,
      },
      'ratings.offensiveRebound': {
        mean: 41.3,
        sd: 5,
        loading: 0.7,
      },
      'ratings.defensiveRebound': {
        mean: 76.1,
        sd: 5.2,
        loading: 0.7,
      },
      'ratings.speed': {
        mean: 47.9,
        sd: 4.9,
        loading: 0.7,
      },
      'ratings.agility': {
        mean: 48.4,
        sd: 4.2,
        loading: 0.7,
      },
      'ratings.strength': {
        mean: 84.5,
        sd: 4.5,
        loading: 0.7,
      },
      'ratings.vertical': {
        mean: 65.5,
        sd: 3.7,
        loading: 0.7,
      },
      'ratings.stamina': {
        mean: 68.6,
        sd: 4.2,
        loading: 0.7,
      },
      'ratings.hustle': {
        mean: 75.4,
        sd: 4.2,
        loading: 0.6,
      },
      'ratings.offensiveIQ': {
        mean: 69.7,
        sd: 3.4,
        loading: 0.7,
      },
      'ratings.defensiveIQ': {
        mean: 66.8,
        sd: 4.2,
        loading: 0.6,
      },
      'ratings.clutch': {
        mean: 71.4,
        sd: 2.5,
        loading: 0.7,
      },
      'ratings.leadership': {
        mean: 64.4,
        sd: 2.5,
        loading: 0.7,
      },
      'tendencies.three': {
        mean: 34.2,
        sd: 6,
        loading: 0,
      },
      'tendencies.midRange': {
        mean: 33.3,
        sd: 6,
        loading: 0.1,
      },
      'tendencies.drive': {
        mean: 45.2,
        sd: 5.3,
        loading: 0,
      },
      'tendencies.post': {
        mean: 74.2,
        sd: 7.3,
        loading: 0.1,
      },
      'tendencies.isolation': {
        mean: 29.8,
        sd: 5.6,
        loading: 0,
      },
      'tendencies.pickAndRoll': {
        mean: 12.1,
        sd: 4.6,
        loading: 0.1,
      },
      'tendencies.cut': {
        mean: 58.8,
        sd: 6.2,
        loading: 0.2,
      },
      'tendencies.dunkOverLayup': {
        mean: 82.2,
        sd: 5.7,
        loading: 0.1,
      },
      'tendencies.pullUpOverPass': {
        mean: 21.7,
        sd: 5.3,
        loading: 0,
      },
      'tendencies.drawFoul': {
        mean: 56.4,
        sd: 6.1,
        loading: 0,
      },
      'tendencies.steal': {
        mean: 42.8,
        sd: 5.7,
        loading: 0.1,
      },
      'tendencies.block': {
        mean: 73,
        sd: 6.6,
        loading: 0.1,
      },
      'tendencies.contest': {
        mean: 79.4,
        sd: 6.5,
        loading: 0.1,
      },
      'tendencies.hardFoul': {
        mean: 53.1,
        sd: 5.8,
        loading: 0,
      },
      'hidden.potential': {
        mean: 77,
        sd: 4.9,
        loading: 0.2,
      },
      'hidden.workEthic': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
      'hidden.offensiveConsistency': {
        mean: 64.3,
        sd: 2.9,
        loading: 0.9,
      },
      'hidden.defensiveConsistency': {
        mean: 72.1,
        sd: 2,
        loading: 0.8,
      },
      'hidden.durabilityBack': {
        mean: 78.6,
        sd: 3.5,
        loading: 0,
      },
      'hidden.durabilityKnees': {
        mean: 77.8,
        sd: 5.7,
        loading: 0,
      },
      'hidden.durabilityAnkles': {
        mean: 78.3,
        sd: 5.2,
        loading: 0,
      },
      'hidden.durabilityFeet': {
        mean: 78.1,
        sd: 5.1,
        loading: 0,
      },
      'hidden.durabilityShoulders': {
        mean: 78.7,
        sd: 3.2,
        loading: 0,
      },
      'hidden.character': {
        mean: 75.3,
        sd: 2.3,
        loading: 0,
      },
    },
  },
  {
    archetype: 'Creatore e tiratore',
    count: 14,
    roles: {
      PG: 10,
      SG: 4,
    },
    secondaryRoles: {
      PG: 4,
      SG: 10,
    },
    heightCm: {
      mean: 190.7,
      sd: 4.7,
    },
    weightKg: {
      mean: 89.3,
      sd: 6.5,
    },
    wingspanRatio: 1.053,
    fields: {
      'ratings.closeShot': {
        mean: 67.7,
        sd: 5.1,
        loading: 0.6,
      },
      'ratings.layup': {
        mean: 81.6,
        sd: 8,
        loading: 0.2,
      },
      'ratings.drivingDunk': {
        mean: 51.3,
        sd: 16.3,
        loading: 0.4,
      },
      'ratings.standingDunk': {
        mean: 30.9,
        sd: 6.2,
        loading: 0.2,
      },
      'ratings.postControl': {
        mean: 34.9,
        sd: 3.4,
        loading: 0.4,
      },
      'ratings.hook': {
        mean: 30.3,
        sd: 4.8,
        loading: 0.5,
      },
      'ratings.postFade': {
        mean: 34.7,
        sd: 4,
        loading: 0.2,
      },
      'ratings.drawFoul': {
        mean: 73.2,
        sd: 6.1,
        loading: 0.5,
      },
      'ratings.midRange': {
        mean: 77.9,
        sd: 8.3,
        loading: 0.4,
      },
      'ratings.threePoint': {
        mean: 87.4,
        sd: 6,
        loading: 0,
      },
      'ratings.pullUp': {
        mean: 89.9,
        sd: 6.6,
        loading: 0.7,
      },
      'ratings.freeThrow': {
        mean: 93.2,
        sd: 5,
        loading: 0.2,
      },
      'ratings.ballHandle': {
        mean: 89.4,
        sd: 5.8,
        loading: 0,
      },
      'ratings.speedWithBall': {
        mean: 85,
        sd: 4.9,
        loading: 0.2,
      },
      'ratings.passAccuracy': {
        mean: 87.5,
        sd: 6.1,
        loading: 0,
      },
      'ratings.passVision': {
        mean: 89.3,
        sd: 5.9,
        loading: 0,
      },
      'ratings.hands': {
        mean: 80,
        sd: 4.3,
        loading: 0,
      },
      'ratings.perimeterDefense': {
        mean: 63.9,
        sd: 12.3,
        loading: 0.1,
      },
      'ratings.interiorDefense': {
        mean: 41.6,
        sd: 3.5,
        loading: 0.7,
      },
      'ratings.steal': {
        mean: 68.7,
        sd: 4.4,
        loading: 0.2,
      },
      'ratings.block': {
        mean: 30.1,
        sd: 4.3,
        loading: 0.7,
      },
      'ratings.helpDefense': {
        mean: 60,
        sd: 3.7,
        loading: 0,
      },
      'ratings.passLaneReading': {
        mean: 68.4,
        sd: 3.6,
        loading: 0,
      },
      'ratings.offensiveRebound': {
        mean: 29,
        sd: 5,
        loading: 0.4,
      },
      'ratings.defensiveRebound': {
        mean: 51,
        sd: 3.3,
        loading: 0,
      },
      'ratings.speed': {
        mean: 89.7,
        sd: 3.9,
        loading: 0,
      },
      'ratings.agility': {
        mean: 87.9,
        sd: 4.6,
        loading: 0.1,
      },
      'ratings.strength': {
        mean: 56.4,
        sd: 6,
        loading: 0.5,
      },
      'ratings.vertical': {
        mean: 77.6,
        sd: 5,
        loading: 0.3,
      },
      'ratings.stamina': {
        mean: 83.7,
        sd: 3.7,
        loading: 0,
      },
      'ratings.hustle': {
        mean: 81,
        sd: 4.2,
        loading: 0,
      },
      'ratings.offensiveIQ': {
        mean: 90.4,
        sd: 5,
        loading: 0.6,
      },
      'ratings.defensiveIQ': {
        mean: 66.3,
        sd: 3.9,
        loading: 0.5,
      },
      'ratings.clutch': {
        mean: 77,
        sd: 5.3,
        loading: 0,
      },
      'ratings.leadership': {
        mean: 66.2,
        sd: 5.3,
        loading: 0,
      },
      'tendencies.three': {
        mean: 83.7,
        sd: 8.7,
        loading: 0,
      },
      'tendencies.midRange': {
        mean: 59.4,
        sd: 6.1,
        loading: 0.8,
      },
      'tendencies.drive': {
        mean: 75.7,
        sd: 5.4,
        loading: 0,
      },
      'tendencies.post': {
        mean: 26.7,
        sd: 7.6,
        loading: 0.4,
      },
      'tendencies.isolation': {
        mean: 73.1,
        sd: 4.8,
        loading: 0,
      },
      'tendencies.pickAndRoll': {
        mean: 90.4,
        sd: 11.7,
        loading: 0,
      },
      'tendencies.cut': {
        mean: 41,
        sd: 9.8,
        loading: 0.6,
      },
      'tendencies.dunkOverLayup': {
        mean: 27.6,
        sd: 4,
        loading: 0.3,
      },
      'tendencies.pullUpOverPass': {
        mean: 67.7,
        sd: 5.4,
        loading: 0.1,
      },
      'tendencies.drawFoul': {
        mean: 67,
        sd: 5.8,
        loading: 0.5,
      },
      'tendencies.steal': {
        mean: 63.3,
        sd: 4.1,
        loading: 0.4,
      },
      'tendencies.block': {
        mean: 22.7,
        sd: 5,
        loading: 0.4,
      },
      'tendencies.contest': {
        mean: 67,
        sd: 5.7,
        loading: 0,
      },
      'tendencies.hardFoul': {
        mean: 30.9,
        sd: 5,
        loading: 0.1,
      },
      'hidden.potential': {
        mean: 79.8,
        sd: 6.7,
        loading: 0.2,
      },
      'hidden.workEthic': {
        mean: 79.2,
        sd: 8.1,
        loading: 0,
      },
      'hidden.offensiveConsistency': {
        mean: 80.4,
        sd: 6.2,
        loading: 0.1,
      },
      'hidden.defensiveConsistency': {
        mean: 66.9,
        sd: 2,
        loading: 0.3,
      },
      'hidden.durabilityBack': {
        mean: 76.7,
        sd: 4.2,
        loading: 0,
      },
      'hidden.durabilityKnees': {
        mean: 70.1,
        sd: 11.6,
        loading: 0.2,
      },
      'hidden.durabilityAnkles': {
        mean: 75.3,
        sd: 7.2,
        loading: 0.2,
      },
      'hidden.durabilityFeet': {
        mean: 76.7,
        sd: 4.2,
        loading: 0,
      },
      'hidden.durabilityShoulders': {
        mean: 75.9,
        sd: 5.1,
        loading: 0,
      },
      'hidden.character': {
        mean: 77.4,
        sd: 5.8,
        loading: 0,
      },
    },
  },
  {
    archetype: 'Esterno versatile',
    count: 114,
    roles: {
      SG: 114,
    },
    secondaryRoles: {
      PG: 70,
      SF: 44,
    },
    heightCm: {
      mean: 196.6,
      sd: 3.5,
    },
    weightKg: {
      mean: 91.3,
      sd: 6.7,
    },
    wingspanRatio: 1.056,
    fields: {
      'ratings.closeShot': {
        mean: 62.5,
        sd: 4.1,
        loading: 0.7,
      },
      'ratings.layup': {
        mean: 69.3,
        sd: 4.7,
        loading: 0.7,
      },
      'ratings.drivingDunk': {
        mean: 57.9,
        sd: 2.9,
        loading: 0.6,
      },
      'ratings.standingDunk': {
        mean: 23.2,
        sd: 3.6,
        loading: 0.7,
      },
      'ratings.postControl': {
        mean: 28.3,
        sd: 4.5,
        loading: 0.5,
      },
      'ratings.hook': {
        mean: 22,
        sd: 3,
        loading: 0.7,
      },
      'ratings.postFade': {
        mean: 26.8,
        sd: 4.5,
        loading: 0.6,
      },
      'ratings.drawFoul': {
        mean: 60.5,
        sd: 4.3,
        loading: 0.7,
      },
      'ratings.midRange': {
        mean: 69.1,
        sd: 4,
        loading: 0.6,
      },
      'ratings.threePoint': {
        mean: 72.1,
        sd: 5.9,
        loading: 0.4,
      },
      'ratings.pullUp': {
        mean: 71.5,
        sd: 4.4,
        loading: 0.7,
      },
      'ratings.freeThrow': {
        mean: 74.5,
        sd: 6.2,
        loading: 0.6,
      },
      'ratings.ballHandle': {
        mean: 67.7,
        sd: 4.5,
        loading: 0.7,
      },
      'ratings.speedWithBall': {
        mean: 71.9,
        sd: 4.9,
        loading: 0.7,
      },
      'ratings.passAccuracy': {
        mean: 66,
        sd: 4.8,
        loading: 0.6,
      },
      'ratings.passVision': {
        mean: 63.5,
        sd: 6.5,
        loading: 0.5,
      },
      'ratings.hands': {
        mean: 72.2,
        sd: 3.9,
        loading: 0.6,
      },
      'ratings.perimeterDefense': {
        mean: 65.2,
        sd: 4.9,
        loading: 0.3,
      },
      'ratings.interiorDefense': {
        mean: 40.7,
        sd: 3.4,
        loading: 0.6,
      },
      'ratings.steal': {
        mean: 64.4,
        sd: 3.3,
        loading: 0.5,
      },
      'ratings.block': {
        mean: 33,
        sd: 3.7,
        loading: 0.4,
      },
      'ratings.helpDefense': {
        mean: 54.3,
        sd: 3.2,
        loading: 0.5,
      },
      'ratings.passLaneReading': {
        mean: 63,
        sd: 3.6,
        loading: 0.4,
      },
      'ratings.offensiveRebound': {
        mean: 29.5,
        sd: 3.7,
        loading: 0.3,
      },
      'ratings.defensiveRebound': {
        mean: 45.8,
        sd: 4,
        loading: 0.5,
      },
      'ratings.speed': {
        mean: 77.5,
        sd: 4.4,
        loading: 0.7,
      },
      'ratings.agility': {
        mean: 75.2,
        sd: 4.7,
        loading: 0.7,
      },
      'ratings.strength': {
        mean: 53.1,
        sd: 4.8,
        loading: 0.7,
      },
      'ratings.vertical': {
        mean: 74.2,
        sd: 3.8,
        loading: 0.6,
      },
      'ratings.stamina': {
        mean: 72.9,
        sd: 4,
        loading: 0.8,
      },
      'ratings.hustle': {
        mean: 71.4,
        sd: 4.4,
        loading: 0.6,
      },
      'ratings.offensiveIQ': {
        mean: 66.6,
        sd: 4.3,
        loading: 0.7,
      },
      'ratings.defensiveIQ': {
        mean: 63.6,
        sd: 4.2,
        loading: 0.6,
      },
      'ratings.clutch': {
        mean: 62.5,
        sd: 2.1,
        loading: 0.6,
      },
      'ratings.leadership': {
        mean: 54.6,
        sd: 2.2,
        loading: 0.6,
      },
      'tendencies.three': {
        mean: 73.7,
        sd: 7.9,
        loading: 0,
      },
      'tendencies.midRange': {
        mean: 60.2,
        sd: 5.3,
        loading: 0.2,
      },
      'tendencies.drive': {
        mean: 69.6,
        sd: 5.9,
        loading: 0.1,
      },
      'tendencies.post': {
        mean: 24.1,
        sd: 6.4,
        loading: 0.1,
      },
      'tendencies.isolation': {
        mean: 66.7,
        sd: 5.1,
        loading: 0.1,
      },
      'tendencies.pickAndRoll': {
        mean: 46.5,
        sd: 5.4,
        loading: 0.4,
      },
      'tendencies.cut': {
        mean: 56.9,
        sd: 4.5,
        loading: 0,
      },
      'tendencies.dunkOverLayup': {
        mean: 33.9,
        sd: 5.7,
        loading: 0,
      },
      'tendencies.pullUpOverPass': {
        mean: 72.1,
        sd: 5.1,
        loading: 0,
      },
      'tendencies.drawFoul': {
        mean: 59.1,
        sd: 5.6,
        loading: 0.3,
      },
      'tendencies.steal': {
        mean: 63.8,
        sd: 4.9,
        loading: 0,
      },
      'tendencies.block': {
        mean: 27.2,
        sd: 5.7,
        loading: 0.1,
      },
      'tendencies.contest': {
        mean: 62.4,
        sd: 6.6,
        loading: 0,
      },
      'tendencies.hardFoul': {
        mean: 32.7,
        sd: 5.4,
        loading: 0,
      },
      'hidden.potential': {
        mean: 78.2,
        sd: 4.3,
        loading: 0.2,
      },
      'hidden.workEthic': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
      'hidden.offensiveConsistency': {
        mean: 61,
        sd: 2.5,
        loading: 0.9,
      },
      'hidden.defensiveConsistency': {
        mean: 63.5,
        sd: 2,
        loading: 0.7,
      },
      'hidden.durabilityBack': {
        mean: 78,
        sd: 5.6,
        loading: 0,
      },
      'hidden.durabilityKnees': {
        mean: 78,
        sd: 5.3,
        loading: 0,
      },
      'hidden.durabilityAnkles': {
        mean: 78.2,
        sd: 4.8,
        loading: 0,
      },
      'hidden.durabilityFeet': {
        mean: 78.1,
        sd: 5.4,
        loading: 0,
      },
      'hidden.durabilityShoulders': {
        mean: 78,
        sd: 5.3,
        loading: 0,
      },
      'hidden.character': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
    },
  },
  {
    archetype: 'Finalizzatore atletico',
    count: 15,
    roles: {
      SG: 8,
      SF: 4,
      PF: 2,
      C: 1,
    },
    secondaryRoles: {
      PG: 5,
      SF: 4,
      PF: 5,
      C: 1,
    },
    heightCm: {
      mean: 199.8,
      sd: 4,
    },
    weightKg: {
      mean: 97.8,
      sd: 11.8,
    },
    wingspanRatio: 1.062,
    fields: {
      'ratings.closeShot': {
        mean: 73.5,
        sd: 10.7,
        loading: 0.4,
      },
      'ratings.layup': {
        mean: 92.1,
        sd: 4.8,
        loading: 0.4,
      },
      'ratings.drivingDunk': {
        mean: 87.7,
        sd: 7.8,
        loading: 0.3,
      },
      'ratings.standingDunk': {
        mean: 40.5,
        sd: 20,
        loading: 0.4,
      },
      'ratings.postControl': {
        mean: 45.1,
        sd: 17.4,
        loading: 0.4,
      },
      'ratings.hook': {
        mean: 36.7,
        sd: 16.2,
        loading: 0.3,
      },
      'ratings.postFade': {
        mean: 40.9,
        sd: 13.3,
        loading: 0.3,
      },
      'ratings.drawFoul': {
        mean: 75.8,
        sd: 7.9,
        loading: 0.4,
      },
      'ratings.midRange': {
        mean: 70.2,
        sd: 4.8,
        loading: 0.3,
      },
      'ratings.threePoint': {
        mean: 66.9,
        sd: 14.2,
        loading: 0,
      },
      'ratings.pullUp': {
        mean: 70,
        sd: 9.6,
        loading: 0.2,
      },
      'ratings.freeThrow': {
        mean: 72.5,
        sd: 4.9,
        loading: 0.3,
      },
      'ratings.ballHandle': {
        mean: 70.1,
        sd: 7.8,
        loading: 0.1,
      },
      'ratings.speedWithBall': {
        mean: 71.9,
        sd: 7.7,
        loading: 0.3,
      },
      'ratings.passAccuracy': {
        mean: 69.2,
        sd: 5.6,
        loading: 0.5,
      },
      'ratings.passVision': {
        mean: 66.9,
        sd: 4.4,
        loading: 0.4,
      },
      'ratings.hands': {
        mean: 75.5,
        sd: 3.2,
        loading: 0.6,
      },
      'ratings.perimeterDefense': {
        mean: 71.1,
        sd: 7.9,
        loading: 0.3,
      },
      'ratings.interiorDefense': {
        mean: 57.1,
        sd: 13.2,
        loading: 0.3,
      },
      'ratings.steal': {
        mean: 65.5,
        sd: 6.3,
        loading: 0,
      },
      'ratings.block': {
        mean: 48,
        sd: 15.1,
        loading: 0.3,
      },
      'ratings.helpDefense': {
        mean: 65.4,
        sd: 8.9,
        loading: 0.4,
      },
      'ratings.passLaneReading': {
        mean: 70,
        sd: 7.3,
        loading: 0.2,
      },
      'ratings.offensiveRebound': {
        mean: 42.8,
        sd: 11.5,
        loading: 0.3,
      },
      'ratings.defensiveRebound': {
        mean: 60.1,
        sd: 10.8,
        loading: 0.3,
      },
      'ratings.speed': {
        mean: 78.3,
        sd: 7.8,
        loading: 0.3,
      },
      'ratings.agility': {
        mean: 78.1,
        sd: 5.9,
        loading: 0.3,
      },
      'ratings.strength': {
        mean: 68.5,
        sd: 11.8,
        loading: 0.4,
      },
      'ratings.vertical': {
        mean: 87.9,
        sd: 3.9,
        loading: 0,
      },
      'ratings.stamina': {
        mean: 79.3,
        sd: 4.2,
        loading: 0.6,
      },
      'ratings.hustle': {
        mean: 77.2,
        sd: 5.2,
        loading: 0.8,
      },
      'ratings.offensiveIQ': {
        mean: 77.7,
        sd: 7.5,
        loading: 0.6,
      },
      'ratings.defensiveIQ': {
        mean: 73.8,
        sd: 8.7,
        loading: 0.6,
      },
      'ratings.clutch': {
        mean: 70.6,
        sd: 7.2,
        loading: 0.7,
      },
      'ratings.leadership': {
        mean: 62.7,
        sd: 5.9,
        loading: 0.6,
      },
      'tendencies.three': {
        mean: 61.5,
        sd: 13.4,
        loading: 0,
      },
      'tendencies.midRange': {
        mean: 58.1,
        sd: 9.6,
        loading: 0,
      },
      'tendencies.drive': {
        mean: 80.2,
        sd: 8.6,
        loading: 0,
      },
      'tendencies.post': {
        mean: 40.3,
        sd: 23.9,
        loading: 0.2,
      },
      'tendencies.isolation': {
        mean: 64,
        sd: 10.2,
        loading: 0,
      },
      'tendencies.pickAndRoll': {
        mean: 39.5,
        sd: 16.9,
        loading: 0,
      },
      'tendencies.cut': {
        mean: 60.9,
        sd: 4.4,
        loading: 0,
      },
      'tendencies.dunkOverLayup': {
        mean: 48.7,
        sd: 15.8,
        loading: 0.1,
      },
      'tendencies.pullUpOverPass': {
        mean: 62.9,
        sd: 15.3,
        loading: 0,
      },
      'tendencies.drawFoul': {
        mean: 67,
        sd: 4.2,
        loading: 0,
      },
      'tendencies.steal': {
        mean: 62.9,
        sd: 7.1,
        loading: 0,
      },
      'tendencies.block': {
        mean: 38.1,
        sd: 15.1,
        loading: 0.2,
      },
      'tendencies.contest': {
        mean: 73.5,
        sd: 15.1,
        loading: 0.5,
      },
      'tendencies.hardFoul': {
        mean: 38,
        sd: 5.6,
        loading: 0.1,
      },
      'hidden.potential': {
        mean: 82.9,
        sd: 4.5,
        loading: 0.4,
      },
      'hidden.workEthic': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
      'hidden.offensiveConsistency': {
        mean: 70.7,
        sd: 7.9,
        loading: 0.7,
      },
      'hidden.defensiveConsistency': {
        mean: 73.4,
        sd: 8.2,
        loading: 0.6,
      },
      'hidden.durabilityBack': {
        mean: 76.2,
        sd: 3.4,
        loading: 0.1,
      },
      'hidden.durabilityKnees': {
        mean: 75.5,
        sd: 4.4,
        loading: 0,
      },
      'hidden.durabilityAnkles': {
        mean: 76.3,
        sd: 3.6,
        loading: 0.2,
      },
      'hidden.durabilityFeet': {
        mean: 74.9,
        sd: 5.6,
        loading: 0,
      },
      'hidden.durabilityShoulders': {
        mean: 76.4,
        sd: 3.4,
        loading: 0.2,
      },
      'hidden.character': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
    },
  },
  {
    archetype: 'Lungo regista',
    count: 5,
    roles: {
      PF: 2,
      C: 3,
    },
    secondaryRoles: {
      SF: 1,
      PF: 3,
      C: 1,
    },
    heightCm: {
      mean: 208.8,
      sd: 3,
    },
    weightKg: {
      mean: 111.5,
      sd: 9.6,
    },
    wingspanRatio: 1.078,
    fields: {
      'ratings.closeShot': {
        mean: 93.8,
        sd: 5.8,
        loading: 0.4,
      },
      'ratings.layup': {
        mean: 84.2,
        sd: 9.4,
        loading: 0.9,
      },
      'ratings.drivingDunk': {
        mean: 77.4,
        sd: 27.7,
        loading: 0.2,
      },
      'ratings.standingDunk': {
        mean: 91.6,
        sd: 6.8,
        loading: 0,
      },
      'ratings.postControl': {
        mean: 92,
        sd: 9.4,
        loading: 0.2,
      },
      'ratings.hook': {
        mean: 80.2,
        sd: 11.4,
        loading: 0.1,
      },
      'ratings.postFade': {
        mean: 75.6,
        sd: 9.2,
        loading: 0.9,
      },
      'ratings.drawFoul': {
        mean: 81.6,
        sd: 9.3,
        loading: 0.9,
      },
      'ratings.midRange': {
        mean: 74.8,
        sd: 14.9,
        loading: 0.5,
      },
      'ratings.threePoint': {
        mean: 60,
        sd: 11.7,
        loading: 0,
      },
      'ratings.pullUp': {
        mean: 63.2,
        sd: 9.7,
        loading: 0.9,
      },
      'ratings.freeThrow': {
        mean: 67.6,
        sd: 8.2,
        loading: 0,
      },
      'ratings.ballHandle': {
        mean: 74.2,
        sd: 12.4,
        loading: 0.9,
      },
      'ratings.speedWithBall': {
        mean: 69.4,
        sd: 9,
        loading: 0.9,
      },
      'ratings.passAccuracy': {
        mean: 91.8,
        sd: 7,
        loading: 0.2,
      },
      'ratings.passVision': {
        mean: 93,
        sd: 5.4,
        loading: 0.6,
      },
      'ratings.hands': {
        mean: 84,
        sd: 5.5,
        loading: 0.7,
      },
      'ratings.perimeterDefense': {
        mean: 62,
        sd: 10.5,
        loading: 0.9,
      },
      'ratings.interiorDefense': {
        mean: 88.6,
        sd: 6.1,
        loading: 0.8,
      },
      'ratings.steal': {
        mean: 60.2,
        sd: 5.5,
        loading: 0.9,
      },
      'ratings.block': {
        mean: 71,
        sd: 7.7,
        loading: 0.6,
      },
      'ratings.helpDefense': {
        mean: 82.6,
        sd: 8,
        loading: 0.6,
      },
      'ratings.passLaneReading': {
        mean: 69.6,
        sd: 6.9,
        loading: 0.9,
      },
      'ratings.offensiveRebound': {
        mean: 59.6,
        sd: 11.5,
        loading: 0.8,
      },
      'ratings.defensiveRebound': {
        mean: 92.4,
        sd: 6.6,
        loading: 0.3,
      },
      'ratings.speed': {
        mean: 69.4,
        sd: 12.2,
        loading: 0.6,
      },
      'ratings.agility': {
        mean: 78.4,
        sd: 11.1,
        loading: 0.9,
      },
      'ratings.strength': {
        mean: 98.4,
        sd: 2,
        loading: 0.1,
      },
      'ratings.vertical': {
        mean: 78,
        sd: 18.2,
        loading: 0.4,
      },
      'ratings.stamina': {
        mean: 90.4,
        sd: 3.9,
        loading: 0,
      },
      'ratings.hustle': {
        mean: 93.4,
        sd: 4.7,
        loading: 0.7,
      },
      'ratings.offensiveIQ': {
        mean: 98.2,
        sd: 2,
        loading: 0.4,
      },
      'ratings.defensiveIQ': {
        mean: 86.6,
        sd: 8.2,
        loading: 0.8,
      },
      'ratings.clutch': {
        mean: 88.2,
        sd: 5.7,
        loading: 0.1,
      },
      'ratings.leadership': {
        mean: 78.8,
        sd: 6.1,
        loading: 0,
      },
      'tendencies.three': {
        mean: 39.6,
        sd: 4.8,
        loading: 0.5,
      },
      'tendencies.midRange': {
        mean: 44.8,
        sd: 7,
        loading: 0.9,
      },
      'tendencies.drive': {
        mean: 61.8,
        sd: 19.5,
        loading: 0.9,
      },
      'tendencies.post': {
        mean: 90.6,
        sd: 11.8,
        loading: 0,
      },
      'tendencies.isolation': {
        mean: 44,
        sd: 9.2,
        loading: 0.6,
      },
      'tendencies.pickAndRoll': {
        mean: 55.8,
        sd: 25,
        loading: 0.4,
      },
      'tendencies.cut': {
        mean: 59.8,
        sd: 6.7,
        loading: 0.4,
      },
      'tendencies.dunkOverLayup': {
        mean: 76.4,
        sd: 6.5,
        loading: 0,
      },
      'tendencies.pullUpOverPass': {
        mean: 27.4,
        sd: 10.4,
        loading: 0.8,
      },
      'tendencies.drawFoul': {
        mean: 62.6,
        sd: 3.4,
        loading: 0.9,
      },
      'tendencies.steal': {
        mean: 52.4,
        sd: 8.7,
        loading: 0.9,
      },
      'tendencies.block': {
        mean: 64.4,
        sd: 15.2,
        loading: 0,
      },
      'tendencies.contest': {
        mean: 86.2,
        sd: 6.7,
        loading: 0.8,
      },
      'tendencies.hardFoul': {
        mean: 52,
        sd: 4.2,
        loading: 0.1,
      },
      'hidden.potential': {
        mean: 87.6,
        sd: 2,
        loading: 0.1,
      },
      'hidden.workEthic': {
        mean: 79,
        sd: 8,
        loading: 0.9,
      },
      'hidden.offensiveConsistency': {
        mean: 89.2,
        sd: 5.3,
        loading: 0.4,
      },
      'hidden.defensiveConsistency': {
        mean: 83.4,
        sd: 5.5,
        loading: 0.8,
      },
      'hidden.durabilityBack': {
        mean: 75.8,
        sd: 3.6,
        loading: 0,
      },
      'hidden.durabilityKnees': {
        mean: 72.8,
        sd: 7.3,
        loading: 0,
      },
      'hidden.durabilityAnkles': {
        mean: 74.8,
        sd: 4.3,
        loading: 0,
      },
      'hidden.durabilityFeet': {
        mean: 76.4,
        sd: 3.7,
        loading: 0.2,
      },
      'hidden.durabilityShoulders': {
        mean: 73.2,
        sd: 7.3,
        loading: 0,
      },
      'hidden.character': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
    },
  },
  {
    archetype: 'Playmaker / creatore',
    count: 16,
    roles: {
      PG: 7,
      SG: 5,
      SF: 4,
    },
    secondaryRoles: {
      PG: 4,
      SG: 7,
      SF: 1,
      PF: 4,
    },
    heightCm: {
      mean: 197.8,
      sd: 4.7,
    },
    weightKg: {
      mean: 96,
      sd: 9,
    },
    wingspanRatio: 1.053,
    fields: {
      'ratings.closeShot': {
        mean: 72.2,
        sd: 7.8,
        loading: 0.7,
      },
      'ratings.layup': {
        mean: 88.1,
        sd: 9.1,
        loading: 0.6,
      },
      'ratings.drivingDunk': {
        mean: 70,
        sd: 15.3,
        loading: 0.7,
      },
      'ratings.standingDunk': {
        mean: 36.4,
        sd: 10.8,
        loading: 0.8,
      },
      'ratings.postControl': {
        mean: 44.3,
        sd: 13.6,
        loading: 0.7,
      },
      'ratings.hook': {
        mean: 38,
        sd: 12.2,
        loading: 0.7,
      },
      'ratings.postFade': {
        mean: 40.3,
        sd: 7.6,
        loading: 0.8,
      },
      'ratings.drawFoul': {
        mean: 78.7,
        sd: 12.3,
        loading: 0.3,
      },
      'ratings.midRange': {
        mean: 76.4,
        sd: 6.9,
        loading: 0.4,
      },
      'ratings.threePoint': {
        mean: 75.3,
        sd: 2.8,
        loading: 0.6,
      },
      'ratings.pullUp': {
        mean: 77,
        sd: 7.6,
        loading: 0.3,
      },
      'ratings.freeThrow': {
        mean: 81.3,
        sd: 6.5,
        loading: 0,
      },
      'ratings.ballHandle': {
        mean: 88.4,
        sd: 5.5,
        loading: 0.4,
      },
      'ratings.speedWithBall': {
        mean: 84.8,
        sd: 6.6,
        loading: 0.2,
      },
      'ratings.passAccuracy': {
        mean: 86.7,
        sd: 7,
        loading: 0.3,
      },
      'ratings.passVision': {
        mean: 89.3,
        sd: 8,
        loading: 0.4,
      },
      'ratings.hands': {
        mean: 79.4,
        sd: 7,
        loading: 0.4,
      },
      'ratings.perimeterDefense': {
        mean: 74.7,
        sd: 6.4,
        loading: 0.6,
      },
      'ratings.interiorDefense': {
        mean: 53.4,
        sd: 10.4,
        loading: 0.7,
      },
      'ratings.steal': {
        mean: 70.7,
        sd: 4,
        loading: 0.4,
      },
      'ratings.block': {
        mean: 40.2,
        sd: 10.1,
        loading: 0.7,
      },
      'ratings.helpDefense': {
        mean: 69.1,
        sd: 6.5,
        loading: 0.9,
      },
      'ratings.passLaneReading': {
        mean: 72.9,
        sd: 5.9,
        loading: 0.6,
      },
      'ratings.offensiveRebound': {
        mean: 36.9,
        sd: 8.5,
        loading: 0.7,
      },
      'ratings.defensiveRebound': {
        mean: 59.3,
        sd: 8.7,
        loading: 0.7,
      },
      'ratings.speed': {
        mean: 86.8,
        sd: 7.1,
        loading: 0.4,
      },
      'ratings.agility': {
        mean: 87.8,
        sd: 7,
        loading: 0.4,
      },
      'ratings.strength': {
        mean: 66.4,
        sd: 9.8,
        loading: 0.9,
      },
      'ratings.vertical': {
        mean: 84,
        sd: 6.6,
        loading: 0.7,
      },
      'ratings.stamina': {
        mean: 84.4,
        sd: 6.1,
        loading: 0.6,
      },
      'ratings.hustle': {
        mean: 85.2,
        sd: 7.5,
        loading: 0.7,
      },
      'ratings.offensiveIQ': {
        mean: 92.3,
        sd: 5.2,
        loading: 0.8,
      },
      'ratings.defensiveIQ': {
        mean: 78.3,
        sd: 9.3,
        loading: 0.7,
      },
      'ratings.clutch': {
        mean: 77.2,
        sd: 8.9,
        loading: 0.4,
      },
      'ratings.leadership': {
        mean: 68.7,
        sd: 10.8,
        loading: 0.6,
      },
      'tendencies.three': {
        mean: 66.3,
        sd: 5.2,
        loading: 0,
      },
      'tendencies.midRange': {
        mean: 62.7,
        sd: 4.8,
        loading: 0.4,
      },
      'tendencies.drive': {
        mean: 79.2,
        sd: 8.5,
        loading: 0,
      },
      'tendencies.post': {
        mean: 30.6,
        sd: 14.6,
        loading: 0.5,
      },
      'tendencies.isolation': {
        mean: 70.4,
        sd: 5.9,
        loading: 0,
      },
      'tendencies.pickAndRoll': {
        mean: 75.4,
        sd: 20.3,
        loading: 0,
      },
      'tendencies.cut': {
        mean: 51.9,
        sd: 11.4,
        loading: 0.3,
      },
      'tendencies.dunkOverLayup': {
        mean: 37.8,
        sd: 10.5,
        loading: 0.8,
      },
      'tendencies.pullUpOverPass': {
        mean: 66.5,
        sd: 5.4,
        loading: 0,
      },
      'tendencies.drawFoul': {
        mean: 68.3,
        sd: 6.9,
        loading: 0,
      },
      'tendencies.steal': {
        mean: 66.6,
        sd: 4.2,
        loading: 0.3,
      },
      'tendencies.block': {
        mean: 32.3,
        sd: 8.9,
        loading: 0.6,
      },
      'tendencies.contest': {
        mean: 76.4,
        sd: 12.2,
        loading: 0.4,
      },
      'tendencies.hardFoul': {
        mean: 32.8,
        sd: 5.8,
        loading: 0,
      },
      'hidden.potential': {
        mean: 80.8,
        sd: 7.3,
        loading: 0,
      },
      'hidden.workEthic': {
        mean: 77.5,
        sd: 6.6,
        loading: 0.4,
      },
      'hidden.offensiveConsistency': {
        mean: 80.3,
        sd: 9.1,
        loading: 0.5,
      },
      'hidden.defensiveConsistency': {
        mean: 74.3,
        sd: 6.5,
        loading: 0.5,
      },
      'hidden.durabilityBack': {
        mean: 77.6,
        sd: 5,
        loading: 0.1,
      },
      'hidden.durabilityKnees': {
        mean: 74.5,
        sd: 10.7,
        loading: 0,
      },
      'hidden.durabilityAnkles': {
        mean: 76.9,
        sd: 5.9,
        loading: 0,
      },
      'hidden.durabilityFeet': {
        mean: 75.1,
        sd: 8.7,
        loading: 0.1,
      },
      'hidden.durabilityShoulders': {
        mean: 76.9,
        sd: 6.5,
        loading: 0.3,
      },
      'hidden.character': {
        mean: 75.2,
        sd: 5.9,
        loading: 0,
      },
    },
  },
  {
    archetype: 'Protettore del ferro',
    count: 18,
    roles: {
      PF: 3,
      C: 15,
    },
    secondaryRoles: {
      SF: 1,
      PF: 15,
      C: 2,
    },
    heightCm: {
      mean: 213.2,
      sd: 4.8,
    },
    weightKg: {
      mean: 108.4,
      sd: 8.3,
    },
    wingspanRatio: 1.076,
    fields: {
      'ratings.closeShot': {
        mean: 82.2,
        sd: 7.6,
        loading: 0.8,
      },
      'ratings.layup': {
        mean: 65.5,
        sd: 7.4,
        loading: 0.8,
      },
      'ratings.drivingDunk': {
        mean: 73.2,
        sd: 7.3,
        loading: 0.8,
      },
      'ratings.standingDunk': {
        mean: 82.3,
        sd: 7.6,
        loading: 0.2,
      },
      'ratings.postControl': {
        mean: 72.3,
        sd: 2.7,
        loading: 0.4,
      },
      'ratings.hook': {
        mean: 64.2,
        sd: 5.2,
        loading: 0.6,
      },
      'ratings.postFade': {
        mean: 56.3,
        sd: 3.9,
        loading: 0.9,
      },
      'ratings.drawFoul': {
        mean: 68.2,
        sd: 7,
        loading: 0.8,
      },
      'ratings.midRange': {
        mean: 57.4,
        sd: 7.6,
        loading: 0.8,
      },
      'ratings.threePoint': {
        mean: 49.8,
        sd: 10.1,
        loading: 0.7,
      },
      'ratings.pullUp': {
        mean: 50.1,
        sd: 12.2,
        loading: 0.8,
      },
      'ratings.freeThrow': {
        mean: 62.4,
        sd: 6.1,
        loading: 0.7,
      },
      'ratings.ballHandle': {
        mean: 46.3,
        sd: 9.3,
        loading: 0.7,
      },
      'ratings.speedWithBall': {
        mean: 53.2,
        sd: 10.8,
        loading: 0.8,
      },
      'ratings.passAccuracy': {
        mean: 66.4,
        sd: 4.2,
        loading: 0.3,
      },
      'ratings.passVision': {
        mean: 56.4,
        sd: 5,
        loading: 0.8,
      },
      'ratings.hands': {
        mean: 77.5,
        sd: 4.8,
        loading: 0.6,
      },
      'ratings.perimeterDefense': {
        mean: 50.9,
        sd: 9.3,
        loading: 0.8,
      },
      'ratings.interiorDefense': {
        mean: 92.3,
        sd: 5.3,
        loading: 0.7,
      },
      'ratings.steal': {
        mean: 48.3,
        sd: 6.1,
        loading: 0.6,
      },
      'ratings.block': {
        mean: 93,
        sd: 5.7,
        loading: 0.2,
      },
      'ratings.helpDefense': {
        mean: 80.5,
        sd: 8.6,
        loading: 0.8,
      },
      'ratings.passLaneReading': {
        mean: 61.9,
        sd: 8,
        loading: 0.7,
      },
      'ratings.offensiveRebound': {
        mean: 47.6,
        sd: 8.9,
        loading: 0.5,
      },
      'ratings.defensiveRebound': {
        mean: 84.4,
        sd: 6.1,
        loading: 0.5,
      },
      'ratings.speed': {
        mean: 58,
        sd: 11.6,
        loading: 0.8,
      },
      'ratings.agility': {
        mean: 58.6,
        sd: 11.6,
        loading: 0.9,
      },
      'ratings.strength': {
        mean: 87.6,
        sd: 4.5,
        loading: 0.5,
      },
      'ratings.vertical': {
        mean: 73.9,
        sd: 8.8,
        loading: 0.9,
      },
      'ratings.stamina': {
        mean: 74.9,
        sd: 5.8,
        loading: 0.8,
      },
      'ratings.hustle': {
        mean: 81.2,
        sd: 6.6,
        loading: 0.7,
      },
      'ratings.offensiveIQ': {
        mean: 75.3,
        sd: 8,
        loading: 0.9,
      },
      'ratings.defensiveIQ': {
        mean: 75.7,
        sd: 10.8,
        loading: 0.9,
      },
      'ratings.clutch': {
        mean: 76.3,
        sd: 6.9,
        loading: 0.8,
      },
      'ratings.leadership': {
        mean: 68.7,
        sd: 5.9,
        loading: 0.9,
      },
      'tendencies.three': {
        mean: 38.6,
        sd: 5.7,
        loading: 0.4,
      },
      'tendencies.midRange': {
        mean: 37.7,
        sd: 5.5,
        loading: 0.7,
      },
      'tendencies.drive': {
        mean: 46.9,
        sd: 7.3,
        loading: 0.5,
      },
      'tendencies.post': {
        mean: 74.8,
        sd: 6.2,
        loading: 0,
      },
      'tendencies.isolation': {
        mean: 34.3,
        sd: 8.4,
        loading: 0.5,
      },
      'tendencies.pickAndRoll': {
        mean: 10.9,
        sd: 4.2,
        loading: 0,
      },
      'tendencies.cut': {
        mean: 59.6,
        sd: 5.9,
        loading: 0.3,
      },
      'tendencies.dunkOverLayup': {
        mean: 81.9,
        sd: 7.7,
        loading: 0,
      },
      'tendencies.pullUpOverPass': {
        mean: 27.6,
        sd: 9.7,
        loading: 0.3,
      },
      'tendencies.drawFoul': {
        mean: 57.9,
        sd: 5.8,
        loading: 0.4,
      },
      'tendencies.steal': {
        mean: 47.6,
        sd: 5.8,
        loading: 0.4,
      },
      'tendencies.block': {
        mean: 91.3,
        sd: 7.3,
        loading: 0,
      },
      'tendencies.contest': {
        mean: 84.8,
        sd: 9.7,
        loading: 0.7,
      },
      'tendencies.hardFoul': {
        mean: 50.1,
        sd: 4.6,
        loading: 0.1,
      },
      'hidden.potential': {
        mean: 79.8,
        sd: 6.9,
        loading: 0.6,
      },
      'hidden.workEthic': {
        mean: 75.8,
        sd: 3.4,
        loading: 0.2,
      },
      'hidden.offensiveConsistency': {
        mean: 70.8,
        sd: 7.9,
        loading: 0.9,
      },
      'hidden.defensiveConsistency': {
        mean: 79.3,
        sd: 6.1,
        loading: 0.9,
      },
      'hidden.durabilityBack': {
        mean: 75.3,
        sd: 4.3,
        loading: 0,
      },
      'hidden.durabilityKnees': {
        mean: 72.8,
        sd: 10.9,
        loading: 0,
      },
      'hidden.durabilityAnkles': {
        mean: 75.7,
        sd: 5.1,
        loading: 0,
      },
      'hidden.durabilityFeet': {
        mean: 73.4,
        sd: 8.9,
        loading: 0,
      },
      'hidden.durabilityShoulders': {
        mean: 75.3,
        sd: 6.7,
        loading: 0,
      },
      'hidden.character': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
    },
  },
  {
    archetype: 'Regista',
    count: 67,
    roles: {
      PG: 67,
    },
    secondaryRoles: {
      SG: 67,
    },
    heightCm: {
      mean: 187.6,
      sd: 2.9,
    },
    weightKg: {
      mean: 88,
      sd: 6,
    },
    wingspanRatio: 1.049,
    fields: {
      'ratings.closeShot': {
        mean: 58.3,
        sd: 4.3,
        loading: 0.5,
      },
      'ratings.layup': {
        mean: 72.7,
        sd: 3.1,
        loading: 0.5,
      },
      'ratings.drivingDunk': {
        mean: 45.6,
        sd: 2.4,
        loading: 0.5,
      },
      'ratings.standingDunk': {
        mean: 20.8,
        sd: 2,
        loading: 0.6,
      },
      'ratings.postControl': {
        mean: 23.5,
        sd: 3.4,
        loading: 0.5,
      },
      'ratings.hook': {
        mean: 21.2,
        sd: 2,
        loading: 0.4,
      },
      'ratings.postFade': {
        mean: 22.9,
        sd: 3,
        loading: 0.6,
      },
      'ratings.drawFoul': {
        mean: 59.8,
        sd: 3.8,
        loading: 0.6,
      },
      'ratings.midRange': {
        mean: 67,
        sd: 3.7,
        loading: 0.6,
      },
      'ratings.threePoint': {
        mean: 70.4,
        sd: 4.4,
        loading: 0.6,
      },
      'ratings.pullUp': {
        mean: 70.1,
        sd: 2.5,
        loading: 0.4,
      },
      'ratings.freeThrow': {
        mean: 75.5,
        sd: 4.2,
        loading: 0.7,
      },
      'ratings.ballHandle': {
        mean: 74.6,
        sd: 2.7,
        loading: 0.7,
      },
      'ratings.speedWithBall': {
        mean: 75.1,
        sd: 4.7,
        loading: 0.6,
      },
      'ratings.passAccuracy': {
        mean: 76.1,
        sd: 5.7,
        loading: 0.7,
      },
      'ratings.passVision': {
        mean: 73.3,
        sd: 3.2,
        loading: 0.6,
      },
      'ratings.hands': {
        mean: 72.5,
        sd: 3.7,
        loading: 0.6,
      },
      'ratings.perimeterDefense': {
        mean: 63.4,
        sd: 4.3,
        loading: 0.5,
      },
      'ratings.interiorDefense': {
        mean: 33.6,
        sd: 3.7,
        loading: 0.4,
      },
      'ratings.steal': {
        mean: 66.6,
        sd: 4.4,
        loading: 0.5,
      },
      'ratings.block': {
        mean: 24.4,
        sd: 3.4,
        loading: 0.3,
      },
      'ratings.helpDefense': {
        mean: 55.6,
        sd: 3.1,
        loading: 0.4,
      },
      'ratings.passLaneReading': {
        mean: 63.7,
        sd: 4.9,
        loading: 0.5,
      },
      'ratings.offensiveRebound': {
        mean: 24.5,
        sd: 4.6,
        loading: 0.5,
      },
      'ratings.defensiveRebound': {
        mean: 43.1,
        sd: 4.4,
        loading: 0.5,
      },
      'ratings.speed': {
        mean: 77,
        sd: 4.5,
        loading: 0.6,
      },
      'ratings.agility': {
        mean: 79.3,
        sd: 4.2,
        loading: 0.7,
      },
      'ratings.strength': {
        mean: 44.3,
        sd: 3.4,
        loading: 0.4,
      },
      'ratings.vertical': {
        mean: 70.4,
        sd: 3.7,
        loading: 0.5,
      },
      'ratings.stamina': {
        mean: 73.9,
        sd: 4.6,
        loading: 0.7,
      },
      'ratings.hustle': {
        mean: 69.7,
        sd: 4.1,
        loading: 0.4,
      },
      'ratings.offensiveIQ': {
        mean: 71.5,
        sd: 2,
        loading: 0.5,
      },
      'ratings.defensiveIQ': {
        mean: 60.2,
        sd: 4.7,
        loading: 0.6,
      },
      'ratings.clutch': {
        mean: 66.3,
        sd: 2.2,
        loading: 0.6,
      },
      'ratings.leadership': {
        mean: 56.3,
        sd: 2.2,
        loading: 0.6,
      },
      'tendencies.three': {
        mean: 70.3,
        sd: 8.7,
        loading: 0.1,
      },
      'tendencies.midRange': {
        mean: 54.6,
        sd: 6,
        loading: 0,
      },
      'tendencies.drive': {
        mean: 73.2,
        sd: 6.9,
        loading: 0.2,
      },
      'tendencies.post': {
        mean: 21,
        sd: 6.8,
        loading: 0.1,
      },
      'tendencies.isolation': {
        mean: 66.8,
        sd: 5.5,
        loading: 0.2,
      },
      'tendencies.pickAndRoll': {
        mean: 77.8,
        sd: 5.5,
        loading: 0.1,
      },
      'tendencies.cut': {
        mean: 38.3,
        sd: 5.7,
        loading: 0,
      },
      'tendencies.dunkOverLayup': {
        mean: 27.4,
        sd: 5.3,
        loading: 0,
      },
      'tendencies.pullUpOverPass': {
        mean: 66.2,
        sd: 5.7,
        loading: 0,
      },
      'tendencies.drawFoul': {
        mean: 61.4,
        sd: 5.1,
        loading: 0.2,
      },
      'tendencies.steal': {
        mean: 62.6,
        sd: 5.4,
        loading: 0.1,
      },
      'tendencies.block': {
        mean: 21.6,
        sd: 5.9,
        loading: 0,
      },
      'tendencies.contest': {
        mean: 64.3,
        sd: 6.6,
        loading: 0.1,
      },
      'tendencies.hardFoul': {
        mean: 31.1,
        sd: 5.5,
        loading: 0,
      },
      'hidden.potential': {
        mean: 77.7,
        sd: 4.7,
        loading: 0,
      },
      'hidden.workEthic': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
      'hidden.offensiveConsistency': {
        mean: 63.3,
        sd: 2.2,
        loading: 0.8,
      },
      'hidden.defensiveConsistency': {
        mean: 62.4,
        sd: 3.2,
        loading: 0.5,
      },
      'hidden.durabilityBack': {
        mean: 79,
        sd: 4.2,
        loading: 0,
      },
      'hidden.durabilityKnees': {
        mean: 78.5,
        sd: 5.2,
        loading: 0,
      },
      'hidden.durabilityAnkles': {
        mean: 79,
        sd: 4,
        loading: 0,
      },
      'hidden.durabilityFeet': {
        mean: 78.4,
        sd: 5.4,
        loading: 0,
      },
      'hidden.durabilityShoulders': {
        mean: 79,
        sd: 4,
        loading: 0,
      },
      'hidden.character': {
        mean: 75.3,
        sd: 2.3,
        loading: 0.1,
      },
    },
  },
  {
    archetype: 'Scorer interno',
    count: 9,
    roles: {
      SF: 2,
      PF: 1,
      C: 6,
    },
    secondaryRoles: {
      SF: 1,
      PF: 8,
    },
    heightCm: {
      mean: 209.4,
      sd: 6.5,
    },
    weightKg: {
      mean: 116.9,
      sd: 9.4,
    },
    wingspanRatio: 1.073,
    fields: {
      'ratings.closeShot': {
        mean: 88.6,
        sd: 4.2,
        loading: 0,
      },
      'ratings.layup': {
        mean: 68.4,
        sd: 7.5,
        loading: 0.9,
      },
      'ratings.drivingDunk': {
        mean: 75.2,
        sd: 4.8,
        loading: 0.8,
      },
      'ratings.standingDunk': {
        mean: 75.9,
        sd: 17.1,
        loading: 0,
      },
      'ratings.postControl': {
        mean: 85.6,
        sd: 8.5,
        loading: 0,
      },
      'ratings.hook': {
        mean: 74.2,
        sd: 6,
        loading: 0,
      },
      'ratings.postFade': {
        mean: 67.9,
        sd: 13.3,
        loading: 0.1,
      },
      'ratings.drawFoul': {
        mean: 73.6,
        sd: 11,
        loading: 0.7,
      },
      'ratings.midRange': {
        mean: 63.3,
        sd: 9.7,
        loading: 0.9,
      },
      'ratings.threePoint': {
        mean: 55.7,
        sd: 15,
        loading: 0.8,
      },
      'ratings.pullUp': {
        mean: 53,
        sd: 11.6,
        loading: 0.8,
      },
      'ratings.freeThrow': {
        mean: 70.8,
        sd: 12.5,
        loading: 0.9,
      },
      'ratings.ballHandle': {
        mean: 52.3,
        sd: 13.3,
        loading: 0.8,
      },
      'ratings.speedWithBall': {
        mean: 58.7,
        sd: 14,
        loading: 0.8,
      },
      'ratings.passAccuracy': {
        mean: 67.6,
        sd: 3.5,
        loading: 0.5,
      },
      'ratings.passVision': {
        mean: 59.8,
        sd: 7.2,
        loading: 0.7,
      },
      'ratings.hands': {
        mean: 77.7,
        sd: 4.8,
        loading: 0.6,
      },
      'ratings.perimeterDefense': {
        mean: 57,
        sd: 12.3,
        loading: 0.8,
      },
      'ratings.interiorDefense': {
        mean: 77.8,
        sd: 4.9,
        loading: 0,
      },
      'ratings.steal': {
        mean: 52.6,
        sd: 12.3,
        loading: 0.7,
      },
      'ratings.block': {
        mean: 71.9,
        sd: 11.3,
        loading: 0,
      },
      'ratings.helpDefense': {
        mean: 74.2,
        sd: 4,
        loading: 0.1,
      },
      'ratings.passLaneReading': {
        mean: 60.7,
        sd: 12,
        loading: 0.9,
      },
      'ratings.offensiveRebound': {
        mean: 47.8,
        sd: 6.8,
        loading: 0.4,
      },
      'ratings.defensiveRebound': {
        mean: 78.9,
        sd: 7.2,
        loading: 0,
      },
      'ratings.speed': {
        mean: 64.6,
        sd: 12.9,
        loading: 0.8,
      },
      'ratings.agility': {
        mean: 65.4,
        sd: 12.2,
        loading: 0.7,
      },
      'ratings.strength': {
        mean: 88.9,
        sd: 7.8,
        loading: 0.1,
      },
      'ratings.vertical': {
        mean: 72.4,
        sd: 4.9,
        loading: 0.9,
      },
      'ratings.stamina': {
        mean: 79.2,
        sd: 7.2,
        loading: 0.7,
      },
      'ratings.hustle': {
        mean: 84,
        sd: 6.8,
        loading: 0.6,
      },
      'ratings.offensiveIQ': {
        mean: 79.4,
        sd: 7.1,
        loading: 0.8,
      },
      'ratings.defensiveIQ': {
        mean: 72.1,
        sd: 5.2,
        loading: 0.9,
      },
      'ratings.clutch': {
        mean: 77.3,
        sd: 6.7,
        loading: 0.6,
      },
      'ratings.leadership': {
        mean: 70.9,
        sd: 6.1,
        loading: 0.6,
      },
      'tendencies.three': {
        mean: 43,
        sd: 13.4,
        loading: 0.7,
      },
      'tendencies.midRange': {
        mean: 44.6,
        sd: 11.2,
        loading: 0.6,
      },
      'tendencies.drive': {
        mean: 51.9,
        sd: 8.8,
        loading: 0.5,
      },
      'tendencies.post': {
        mean: 86.6,
        sd: 9,
        loading: 0,
      },
      'tendencies.isolation': {
        mean: 40,
        sd: 15.5,
        loading: 0.7,
      },
      'tendencies.pickAndRoll': {
        mean: 18.6,
        sd: 12.1,
        loading: 0.4,
      },
      'tendencies.cut': {
        mean: 57.6,
        sd: 3.3,
        loading: 0,
      },
      'tendencies.dunkOverLayup': {
        mean: 74.6,
        sd: 14,
        loading: 0,
      },
      'tendencies.pullUpOverPass': {
        mean: 35.6,
        sd: 18,
        loading: 0.6,
      },
      'tendencies.drawFoul': {
        mean: 57.6,
        sd: 5.6,
        loading: 0.6,
      },
      'tendencies.steal': {
        mean: 48.8,
        sd: 12.2,
        loading: 0.6,
      },
      'tendencies.block': {
        mean: 62.9,
        sd: 13.6,
        loading: 0,
      },
      'tendencies.contest': {
        mean: 80.1,
        sd: 8.3,
        loading: 0.5,
      },
      'tendencies.hardFoul': {
        mean: 47.3,
        sd: 7.1,
        loading: 0,
      },
      'hidden.potential': {
        mean: 77.2,
        sd: 5.8,
        loading: 0.4,
      },
      'hidden.workEthic': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
      'hidden.offensiveConsistency': {
        mean: 74.8,
        sd: 7.9,
        loading: 0.9,
      },
      'hidden.defensiveConsistency': {
        mean: 76.2,
        sd: 3.3,
        loading: 0.7,
      },
      'hidden.durabilityBack': {
        mean: 75.6,
        sd: 5.4,
        loading: 0.1,
      },
      'hidden.durabilityKnees': {
        mean: 66.3,
        sd: 14.5,
        loading: 0,
      },
      'hidden.durabilityAnkles': {
        mean: 74.1,
        sd: 6.2,
        loading: 0,
      },
      'hidden.durabilityFeet': {
        mean: 73.8,
        sd: 7.1,
        loading: 0,
      },
      'hidden.durabilityShoulders': {
        mean: 75.2,
        sd: 6.2,
        loading: 0.1,
      },
      'hidden.character': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
    },
  },
  {
    archetype: 'Specialista difensivo',
    count: 11,
    roles: {
      PG: 1,
      SG: 5,
      SF: 3,
      PF: 2,
    },
    secondaryRoles: {
      PG: 4,
      SG: 1,
      SF: 3,
      PF: 3,
    },
    heightCm: {
      mean: 197.4,
      sd: 6.5,
    },
    weightKg: {
      mean: 96.9,
      sd: 7.5,
    },
    wingspanRatio: 1.059,
    fields: {
      'ratings.closeShot': {
        mean: 67.8,
        sd: 6.8,
        loading: 0.7,
      },
      'ratings.layup': {
        mean: 70.6,
        sd: 5.7,
        loading: 0.6,
      },
      'ratings.drivingDunk': {
        mean: 63.3,
        sd: 9.4,
        loading: 0.4,
      },
      'ratings.standingDunk': {
        mean: 35.9,
        sd: 14.5,
        loading: 0.4,
      },
      'ratings.postControl': {
        mean: 38.1,
        sd: 12.6,
        loading: 0.4,
      },
      'ratings.hook': {
        mean: 31.4,
        sd: 11.4,
        loading: 0.4,
      },
      'ratings.postFade': {
        mean: 35.3,
        sd: 10.7,
        loading: 0.4,
      },
      'ratings.drawFoul': {
        mean: 60.5,
        sd: 3.1,
        loading: 0.7,
      },
      'ratings.midRange': {
        mean: 67.2,
        sd: 5.8,
        loading: 0.3,
      },
      'ratings.threePoint': {
        mean: 68.2,
        sd: 6.9,
        loading: 0.1,
      },
      'ratings.pullUp': {
        mean: 66.7,
        sd: 7.7,
        loading: 0.2,
      },
      'ratings.freeThrow': {
        mean: 72.6,
        sd: 4.8,
        loading: 0.3,
      },
      'ratings.ballHandle': {
        mean: 65.4,
        sd: 10,
        loading: 0.3,
      },
      'ratings.speedWithBall': {
        mean: 72.2,
        sd: 8,
        loading: 0.3,
      },
      'ratings.passAccuracy': {
        mean: 70.7,
        sd: 9.9,
        loading: 0.2,
      },
      'ratings.passVision': {
        mean: 67.5,
        sd: 11.6,
        loading: 0.4,
      },
      'ratings.hands': {
        mean: 73.5,
        sd: 5,
        loading: 0.4,
      },
      'ratings.perimeterDefense': {
        mean: 76.4,
        sd: 7.7,
        loading: 0.3,
      },
      'ratings.interiorDefense': {
        mean: 60.1,
        sd: 16.1,
        loading: 0.3,
      },
      'ratings.steal': {
        mean: 65.5,
        sd: 6.1,
        loading: 0.3,
      },
      'ratings.block': {
        mean: 44.9,
        sd: 16.1,
        loading: 0.3,
      },
      'ratings.helpDefense': {
        mean: 73,
        sd: 8.9,
        loading: 0.5,
      },
      'ratings.passLaneReading': {
        mean: 74.9,
        sd: 3.2,
        loading: 0.3,
      },
      'ratings.offensiveRebound': {
        mean: 39.1,
        sd: 13.8,
        loading: 0.3,
      },
      'ratings.defensiveRebound': {
        mean: 55.2,
        sd: 11.1,
        loading: 0.4,
      },
      'ratings.speed': {
        mean: 76.3,
        sd: 6.7,
        loading: 0.3,
      },
      'ratings.agility': {
        mean: 76.5,
        sd: 7.4,
        loading: 0.5,
      },
      'ratings.strength': {
        mean: 62.5,
        sd: 11.2,
        loading: 0.5,
      },
      'ratings.vertical': {
        mean: 77.3,
        sd: 4.3,
        loading: 0.7,
      },
      'ratings.stamina': {
        mean: 76.8,
        sd: 4.9,
        loading: 0.5,
      },
      'ratings.hustle': {
        mean: 72.5,
        sd: 5.8,
        loading: 0.7,
      },
      'ratings.offensiveIQ': {
        mean: 69.3,
        sd: 4.6,
        loading: 0.5,
      },
      'ratings.defensiveIQ': {
        mean: 82.2,
        sd: 7.3,
        loading: 0.4,
      },
      'ratings.clutch': {
        mean: 65.5,
        sd: 3,
        loading: 0.3,
      },
      'ratings.leadership': {
        mean: 58.7,
        sd: 2.5,
        loading: 0.4,
      },
      'tendencies.three': {
        mean: 69.1,
        sd: 14.1,
        loading: 0,
      },
      'tendencies.midRange': {
        mean: 57.5,
        sd: 7.4,
        loading: 0,
      },
      'tendencies.drive': {
        mean: 66.6,
        sd: 6.2,
        loading: 0,
      },
      'tendencies.post': {
        mean: 38,
        sd: 16.3,
        loading: 0.1,
      },
      'tendencies.isolation': {
        mean: 58.9,
        sd: 7.7,
        loading: 0,
      },
      'tendencies.pickAndRoll': {
        mean: 41.8,
        sd: 16.1,
        loading: 0,
      },
      'tendencies.cut': {
        mean: 57.8,
        sd: 8.1,
        loading: 0.3,
      },
      'tendencies.dunkOverLayup': {
        mean: 44.1,
        sd: 17.1,
        loading: 0.3,
      },
      'tendencies.pullUpOverPass': {
        mean: 63.9,
        sd: 9.8,
        loading: 0,
      },
      'tendencies.drawFoul': {
        mean: 53.8,
        sd: 4.2,
        loading: 0,
      },
      'tendencies.steal': {
        mean: 67.3,
        sd: 4.4,
        loading: 0,
      },
      'tendencies.block': {
        mean: 38,
        sd: 16.1,
        loading: 0.2,
      },
      'tendencies.contest': {
        mean: 93.1,
        sd: 6.3,
        loading: 0.1,
      },
      'tendencies.hardFoul': {
        mean: 36.9,
        sd: 6.5,
        loading: 0.2,
      },
      'hidden.potential': {
        mean: 73.8,
        sd: 4.8,
        loading: 0.2,
      },
      'hidden.workEthic': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
      'hidden.offensiveConsistency': {
        mean: 63.5,
        sd: 3,
        loading: 0.7,
      },
      'hidden.defensiveConsistency': {
        mean: 78.2,
        sd: 5.8,
        loading: 0.6,
      },
      'hidden.durabilityBack': {
        mean: 78.3,
        sd: 5.3,
        loading: 0,
      },
      'hidden.durabilityKnees': {
        mean: 76.9,
        sd: 8.1,
        loading: 0.2,
      },
      'hidden.durabilityAnkles': {
        mean: 77.3,
        sd: 6.6,
        loading: 0,
      },
      'hidden.durabilityFeet': {
        mean: 78.4,
        sd: 5.1,
        loading: 0,
      },
      'hidden.durabilityShoulders': {
        mean: 77.4,
        sd: 8,
        loading: 0.2,
      },
      'hidden.character': {
        mean: 75,
        sd: 8.5,
        loading: 0,
      },
    },
  },
  {
    archetype: 'Tiratore / scorer',
    count: 25,
    roles: {
      PG: 4,
      SG: 12,
      SF: 8,
      PF: 1,
    },
    secondaryRoles: {
      PG: 9,
      SG: 4,
      SF: 4,
      PF: 8,
    },
    heightCm: {
      mean: 197.2,
      sd: 6,
    },
    weightKg: {
      mean: 95.7,
      sd: 5.2,
    },
    wingspanRatio: 1.059,
    fields: {
      'ratings.closeShot': {
        mean: 70.1,
        sd: 8.6,
        loading: 0.7,
      },
      'ratings.layup': {
        mean: 75.6,
        sd: 6.9,
        loading: 0.7,
      },
      'ratings.drivingDunk': {
        mean: 65.3,
        sd: 12.1,
        loading: 0.7,
      },
      'ratings.standingDunk': {
        mean: 33.8,
        sd: 13.6,
        loading: 0.6,
      },
      'ratings.postControl': {
        mean: 39.8,
        sd: 15.2,
        loading: 0.6,
      },
      'ratings.hook': {
        mean: 32.3,
        sd: 11.2,
        loading: 0.6,
      },
      'ratings.postFade': {
        mean: 37.9,
        sd: 15.3,
        loading: 0.7,
      },
      'ratings.drawFoul': {
        mean: 64.9,
        sd: 6.7,
        loading: 0.7,
      },
      'ratings.midRange': {
        mean: 73.1,
        sd: 6.9,
        loading: 0.8,
      },
      'ratings.threePoint': {
        mean: 86.6,
        sd: 5.7,
        loading: 0.5,
      },
      'ratings.pullUp': {
        mean: 85.5,
        sd: 7.7,
        loading: 0.5,
      },
      'ratings.freeThrow': {
        mean: 87.6,
        sd: 6.1,
        loading: 0.5,
      },
      'ratings.ballHandle': {
        mean: 72.5,
        sd: 5.7,
        loading: 0.5,
      },
      'ratings.speedWithBall': {
        mean: 75.8,
        sd: 6,
        loading: 0.5,
      },
      'ratings.passAccuracy': {
        mean: 72.8,
        sd: 8.2,
        loading: 0,
      },
      'ratings.passVision': {
        mean: 67.7,
        sd: 5.6,
        loading: 0.4,
      },
      'ratings.hands': {
        mean: 79.2,
        sd: 5,
        loading: 0.4,
      },
      'ratings.perimeterDefense': {
        mean: 67.6,
        sd: 5.3,
        loading: 0.7,
      },
      'ratings.interiorDefense': {
        mean: 50.4,
        sd: 12.8,
        loading: 0.5,
      },
      'ratings.steal': {
        mean: 66.6,
        sd: 5,
        loading: 0.5,
      },
      'ratings.block': {
        mean: 40.6,
        sd: 12.7,
        loading: 0.5,
      },
      'ratings.helpDefense': {
        mean: 60.6,
        sd: 5.9,
        loading: 0.5,
      },
      'ratings.passLaneReading': {
        mean: 65.6,
        sd: 3.8,
        loading: 0.6,
      },
      'ratings.offensiveRebound': {
        mean: 35.6,
        sd: 11,
        loading: 0.4,
      },
      'ratings.defensiveRebound': {
        mean: 54.8,
        sd: 11.2,
        loading: 0.6,
      },
      'ratings.speed': {
        mean: 82,
        sd: 5.6,
        loading: 0.6,
      },
      'ratings.agility': {
        mean: 81.7,
        sd: 6.4,
        loading: 0.6,
      },
      'ratings.strength': {
        mean: 62.8,
        sd: 12.8,
        loading: 0.7,
      },
      'ratings.vertical': {
        mean: 77.5,
        sd: 6.1,
        loading: 0.9,
      },
      'ratings.stamina': {
        mean: 80.1,
        sd: 5.1,
        loading: 0.7,
      },
      'ratings.hustle': {
        mean: 78.2,
        sd: 7.6,
        loading: 0.8,
      },
      'ratings.offensiveIQ': {
        mean: 73.1,
        sd: 6.7,
        loading: 0.8,
      },
      'ratings.defensiveIQ': {
        mean: 66.5,
        sd: 4.8,
        loading: 0.8,
      },
      'ratings.clutch': {
        mean: 69,
        sd: 6.8,
        loading: 0.8,
      },
      'ratings.leadership': {
        mean: 60.6,
        sd: 6.3,
        loading: 0.8,
      },
      'tendencies.three': {
        mean: 87.8,
        sd: 9.1,
        loading: 0,
      },
      'tendencies.midRange': {
        mean: 61.6,
        sd: 5.5,
        loading: 0.3,
      },
      'tendencies.drive': {
        mean: 65.1,
        sd: 6.2,
        loading: 0.1,
      },
      'tendencies.post': {
        mean: 32,
        sd: 14.9,
        loading: 0.4,
      },
      'tendencies.isolation': {
        mean: 64,
        sd: 8,
        loading: 0.3,
      },
      'tendencies.pickAndRoll': {
        mean: 47.7,
        sd: 16.1,
        loading: 0,
      },
      'tendencies.cut': {
        mean: 52.1,
        sd: 9.4,
        loading: 0.3,
      },
      'tendencies.dunkOverLayup': {
        mean: 39,
        sd: 14.8,
        loading: 0.4,
      },
      'tendencies.pullUpOverPass': {
        mean: 70.2,
        sd: 6.9,
        loading: 0,
      },
      'tendencies.drawFoul': {
        mean: 57.4,
        sd: 7.1,
        loading: 0.4,
      },
      'tendencies.steal': {
        mean: 61.6,
        sd: 4.5,
        loading: 0.2,
      },
      'tendencies.block': {
        mean: 32.8,
        sd: 10.3,
        loading: 0.5,
      },
      'tendencies.contest': {
        mean: 65,
        sd: 8.7,
        loading: 0,
      },
      'tendencies.hardFoul': {
        mean: 32.5,
        sd: 4.7,
        loading: 0.1,
      },
      'hidden.potential': {
        mean: 76.2,
        sd: 6,
        loading: 0.5,
      },
      'hidden.workEthic': {
        mean: 75,
        sd: 2,
        loading: 0,
      },
      'hidden.offensiveConsistency': {
        mean: 67.9,
        sd: 7.2,
        loading: 0.8,
      },
      'hidden.defensiveConsistency': {
        mean: 67.2,
        sd: 3.6,
        loading: 0.7,
      },
      'hidden.durabilityBack': {
        mean: 76.6,
        sd: 6.6,
        loading: 0,
      },
      'hidden.durabilityKnees': {
        mean: 76.5,
        sd: 6.8,
        loading: 0,
      },
      'hidden.durabilityAnkles': {
        mean: 77.6,
        sd: 4.9,
        loading: 0,
      },
      'hidden.durabilityFeet': {
        mean: 74.6,
        sd: 9.6,
        loading: 0,
      },
      'hidden.durabilityShoulders': {
        mean: 77.6,
        sd: 4.9,
        loading: 0,
      },
      'hidden.character': {
        mean: 74.6,
        sd: 2,
        loading: 0,
      },
    },
  },
];
