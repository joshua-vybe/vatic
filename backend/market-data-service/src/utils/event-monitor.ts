import { getPrismaClient } from '../db';
import { publishEvent, TOPIC_EVENT_CANCELLED } from './kafka';
import { createLogger } from './logger';

const logger = createLogger('event-monitor');

export async function updateEventStatus(
  eventId: string,
  source: string,
  status: string
): Promise<boolean> {
  try {
    const prisma = getPrismaClient();

    // Query existing record
    const existingRecord = await prisma.eventStatus.findUnique({
      where: { eventId },
    });

    let shouldPublishCancellation = false;

    // Check if status changed to cancelled/disputed
    if (existingRecord) {
      if (existingRecord.status !== status && (status === 'cancelled' || status === 'disputed')) {
        logger.info('Event status changed to terminal state', {
          eventId,
          source,
          oldStatus: existingRecord.status,
          newStatus: status,
        });

        // Update database
        await prisma.eventStatus.update({
          where: { eventId },
          data: { status, source },
        });

        shouldPublishCancellation = true;
      } else if (existingRecord.status === status) {
        // Status unchanged, no action needed
        logger.debug('Event status unchanged', { eventId, status });
        return false;
      } else {
        // Status changed but not to terminal state
        await prisma.eventStatus.update({
          where: { eventId },
          data: { status, source },
        });
        logger.debug('Event status updated', { eventId, source, status });
        return false;
      }
    } else {
      // Insert new record
      await prisma.eventStatus.create({
        data: {
          eventId,
          source,
          status,
        },
      });

      logger.debug('Event status created', { eventId, source, status });

      // Publish if new record is already in cancelled/disputed state
      if (status === 'cancelled' || status === 'disputed') {
        shouldPublishCancellation = true;
      }
    }

    // Publish Kafka event only once per transition
    if (shouldPublishCancellation) {
      await publishEvent(TOPIC_EVENT_CANCELLED, {
        event_id: eventId,
        source,
        status,
        timestamp: Date.now(),
      });
      logger.info('Event cancellation published', { eventId, source, status });
      return true;
    }

    return false;
  } catch (error) {
    logger.error('Failed to update event status', {
      eventId,
      source,
      error: String(error),
    });
    return false;
  }
}

export async function getEventStatus(eventId: string): Promise<string | null> {
  try {
    const prisma = getPrismaClient();

    const record = await prisma.eventStatus.findUnique({
      where: { eventId },
    });

    return record?.status || null;
  } catch (error) {
    logger.error('Failed to get event status', { eventId, error: String(error) });
    return null;
  }
}
