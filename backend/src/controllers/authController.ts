import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import { IUser } from '../models/User';

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error("FATAL ERROR: JWT_SECRET is not defined in production environment.");
  }
  return process.env.JWT_SECRET || 'farmchain_super_secret_key';
};

const signToken = (id: string, role: string) =>
  jwt.sign({ id, role }, getJwtSecret(), { expiresIn: '30d' });

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role, walletAddress } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ success: false, message: 'Please provide name, email and password' });
      return;
    }

    // Prevent direct registration of admin accounts
    let assignedRole = role || 'consumer';
    if (assignedRole === 'admin') {
      assignedRole = 'consumer'; // Fallback to consumer if they try to hack the API
    }
    
    if (assignedRole !== 'consumer') {
      assignedRole = `pending_${assignedRole}`;
    }

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      res.status(400).json({ success: false, message: 'User with this email already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        name,
        email,
        password: hashedPassword,
        role: assignedRole,
        wallet_address: walletAddress,
      })
      .select('id, name, email, role')
      .single();

    if (error || !user) {
      res.status(500).json({ success: false, message: 'Server Error' });
      return;
    }

    // Don't auto-login if pending
    if (user.role.startsWith('pending_')) {
      res.status(201).json({
        success: true,
        message: 'Registration successful! Please wait for an admin to approve your account before logging in.',
      });
      return;
    }

    const token = signToken(user.id, user.role);

    res.status(201).json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, availability_status: (user as any).availability_status },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Please provide email and password' });
      return;
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, password, role, availability_status')
      .eq('email', email)
      .maybeSingle<IUser>();

    if (error || !user) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    if (user.role.startsWith('pending_')) {
      res.status(403).json({ success: false, message: 'Your account is pending admin approval.' });
      return;
    }

    const token = signToken(user.id, user.role);

    res.status(200).json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, availability_status: (user as any).availability_status },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const updateUserStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { availability_status } = req.body;

    const { data: user, error } = await supabase
      .from('users')
      .update({ availability_status })
      .eq('id', userId)
      .select('id, name, email, role, availability_status')
      .single();

    if (error) {
      res.status(500).json({ success: false, message: 'Server Error updating status' });
      return;
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getDistributors = async (req: Request, res: Response): Promise<void> => {
  try {
    const { data: distributors, error } = await supabase
      .from('users')
      .select('id, name, email, availability_status')
      .eq('role', 'distributor');

    if (error) {
      res.status(500).json({ success: false, message: 'Server Error' });
      return;
    }

    res.status(200).json({ success: true, data: distributors });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
