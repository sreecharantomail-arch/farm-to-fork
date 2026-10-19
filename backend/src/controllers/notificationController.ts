import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

// Helper to safely get the user ID
const getUserId = (req: Request): string | null => {
  return (req as any).user?.id || null;
};

export const getNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      // If table doesn't exist yet, return empty array to avoid breaking the frontend
      if (error.code === '42P01') {
        res.status(200).json({ success: true, data: [] });
        return;
      }
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getUnreadCount = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      if (error.code === '42P01') {
        res.status(200).json({ success: true, count: 0 });
        return;
      }
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, count: count || 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const markAsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', userId); // Secure: ensure user owns the notification

    if (error) {
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, message: 'Marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const markAllAsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, message: 'All marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Internal service to create a notification if it doesn't already exist
export const generateNotification = async (
  userId: string,
  type: string,
  title: string,
  message: string,
  relatedEntityType?: string,
  relatedEntityId?: string
) => {
  try {
    // Deduplication check
    // If it's a state change or expiry alert, we only want one notification per type per entity
    if (relatedEntityType && relatedEntityId) {
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', userId)
        .eq('type', type)
        .eq('message', message)
        .eq('related_entity_type', relatedEntityType)
        .eq('related_entity_id', relatedEntityId)
        .limit(1);

      if (existing && existing.length > 0) {
        return; // Already notified
      }
    }

    await supabase.from('notifications').insert({
      user_id: userId,
      type,
      title,
      message,
      related_entity_type: relatedEntityType || null,
      related_entity_id: relatedEntityId || null
    });
  } catch (err) {
    console.error('Error generating notification', err);
  }
};
