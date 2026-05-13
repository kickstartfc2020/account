export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          code: string;
          status: 'active' | 'inactive' | 'archived';
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code: string;
          status?: 'active' | 'inactive' | 'archived';
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          code?: string;
          status?: 'active' | 'inactive' | 'archived';
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      branches: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          address: string | null;
          phone: string | null;
          email: string | null;
          image: string | null;
          status: 'active' | 'inactive' | 'archived';
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          address?: string | null;
          phone?: string | null;
          email?: string | null;
          image?: string | null;
          status?: 'active' | 'inactive' | 'archived';
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          address?: string | null;
          phone?: string | null;
          email?: string | null;
          image?: string | null;
          status?: 'active' | 'inactive' | 'archived';
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          organization_id: string | null;
          branch_id: string | null;
          role: 'super_admin' | 'organization_admin' | 'branch_manager';
          full_name: string | null;
          status: 'active' | 'inactive' | 'archived';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          organization_id?: string | null;
          branch_id?: string | null;
          role: 'super_admin' | 'organization_admin' | 'branch_manager';
          full_name?: string | null;
          status?: 'active' | 'inactive' | 'archived';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string | null;
          branch_id?: string | null;
          role?: 'super_admin' | 'organization_admin' | 'branch_manager';
          full_name?: string | null;
          status?: 'active' | 'inactive' | 'archived';
          created_at?: string;
          updated_at?: string;
        };
      };
      sports: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string | null;
          name: string;
          status: 'active' | 'inactive' | 'archived';
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          branch_id?: string | null;
          name: string;
          status?: 'active' | 'inactive' | 'archived';
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          branch_id?: string | null;
          name?: string;
          status?: 'active' | 'inactive' | 'archived';
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      packages: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string | null;
          sport_id: string;
          name: string;
          billing_type: 'one_time' | 'recurring_monthly';
          duration_months: number;
          amount: number;
          gst_percent: number;
          status: 'active' | 'inactive' | 'archived';
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          branch_id?: string | null;
          sport_id: string;
          name: string;
          billing_type: 'one_time' | 'recurring_monthly';
          duration_months?: number;
          amount: number;
          gst_percent?: number;
          status?: 'active' | 'inactive' | 'archived';
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          branch_id?: string | null;
          sport_id?: string;
          name?: string;
          billing_type?: 'one_time' | 'recurring_monthly';
          duration_months?: number;
          amount?: number;
          gst_percent?: number;
          status?: 'active' | 'inactive' | 'archived';
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      students: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string;
          current_package_id: string | null;
          name: string;
          phone: string;
          email: string | null;
          joined_at: string;
          status: 'active' | 'inactive' | 'archived';
          archived_at: string | null;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          branch_id: string;
          current_package_id?: string | null;
          name: string;
          phone: string;
          email?: string | null;
          joined_at?: string;
          status?: 'active' | 'inactive' | 'archived';
          archived_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          branch_id?: string;
          current_package_id?: string | null;
          name?: string;
          phone?: string;
          email?: string | null;
          joined_at?: string;
          status?: 'active' | 'inactive' | 'archived';
          archived_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      invoices: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string;
          student_id: string;
          invoice_number: string;
          invoice_date: string;
          due_date: string | null;
          status: 'draft' | 'unpaid' | 'partial' | 'completed' | 'cancelled';
          currency: 'INR';
          subtotal: number;
          tax_total: number;
          discount_total: number;
          total_amount: number;
          balance_amount: number;
          notes: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          archived_at: string | null;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          branch_id: string;
          student_id: string;
          invoice_number: string;
          invoice_date?: string;
          due_date?: string | null;
          status?: 'draft' | 'unpaid' | 'partial' | 'completed' | 'cancelled';
          currency?: 'INR';
          subtotal?: number;
          tax_total?: number;
          discount_total?: number;
          total_amount?: number;
          balance_amount?: number;
          notes?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          archived_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          branch_id?: string;
          student_id?: string;
          invoice_number?: string;
          invoice_date?: string;
          due_date?: string | null;
          status?: 'draft' | 'unpaid' | 'partial' | 'completed' | 'cancelled';
          currency?: 'INR';
          subtotal?: number;
          tax_total?: number;
          discount_total?: number;
          total_amount?: number;
          balance_amount?: number;
          notes?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          archived_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      invoice_items: {
        Row: {
          id: string;
          organization_id: string;
          invoice_id: string;
          package_id: string | null;
          sport_id: string | null;
          description: string;
          quantity: number;
          unit_price: number;
          gst_percent: number;
          line_subtotal: number;
          line_tax: number;
          line_total: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          invoice_id: string;
          package_id?: string | null;
          sport_id?: string | null;
          description: string;
          quantity?: number;
          unit_price: number;
          gst_percent?: number;
          line_subtotal?: number;
          line_tax?: number;
          line_total?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          invoice_id?: string;
          package_id?: string | null;
          sport_id?: string | null;
          description?: string;
          quantity?: number;
          unit_price?: number;
          gst_percent?: number;
          line_subtotal?: number;
          line_tax?: number;
          line_total?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      payments: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string;
          invoice_id: string;
          amount: number;
          payment_date: string;
          method: 'cash' | 'card' | 'upi' | 'online' | 'bank_transfer';
          status: 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded';
          reference_no: string | null;
          notes: string | null;
          archived_at: string | null;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          branch_id: string;
          invoice_id: string;
          amount: number;
          payment_date?: string;
          method: 'cash' | 'card' | 'upi' | 'online' | 'bank_transfer';
          status?: 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded';
          reference_no?: string | null;
          notes?: string | null;
          archived_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          branch_id?: string;
          invoice_id?: string;
          amount?: number;
          payment_date?: string;
          method?: 'cash' | 'card' | 'upi' | 'online' | 'bank_transfer';
          status?: 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded';
          reference_no?: string | null;
          notes?: string | null;
          archived_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      renewals: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string;
          student_id: string;
          package_id: string;
          source_invoice_id: string | null;
          generated_invoice_id: string | null;
          cycle_start: string;
          cycle_end: string;
          due_date: string;
          status: 'pending' | 'completed' | 'cancelled' | 'overdue';
          balance_amount: number;
          generated_at: string;
          processed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          branch_id: string;
          student_id: string;
          package_id: string;
          source_invoice_id?: string | null;
          generated_invoice_id?: string | null;
          cycle_start: string;
          cycle_end: string;
          due_date: string;
          status?: 'pending' | 'completed' | 'cancelled' | 'overdue';
          balance_amount?: number;
          generated_at?: string;
          processed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          branch_id?: string;
          student_id?: string;
          package_id?: string;
          source_invoice_id?: string | null;
          generated_invoice_id?: string | null;
          cycle_start?: string;
          cycle_end?: string;
          due_date?: string;
          status?: 'pending' | 'completed' | 'cancelled' | 'overdue';
          balance_amount?: number;
          generated_at?: string;
          processed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      audit_logs: {
        Row: {
          id: number;
          organization_id: string | null;
          branch_id: string | null;
          actor_user_id: string | null;
          actor_profile_id: string | null;
          table_name: string;
          record_id: string | null;
          action: 'insert' | 'update' | 'cancel' | 'archive' | 'status_change' | 'payment_change';
          previous_value: Json | null;
          new_value: Json | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          organization_id?: string | null;
          branch_id?: string | null;
          actor_user_id?: string | null;
          actor_profile_id?: string | null;
          table_name: string;
          record_id?: string | null;
          action: 'insert' | 'update' | 'cancel' | 'archive' | 'status_change' | 'payment_change';
          previous_value?: Json | null;
          new_value?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string | null;
          branch_id?: string | null;
          actor_user_id?: string | null;
          actor_profile_id?: string | null;
          table_name?: string;
          record_id?: string | null;
          action?: 'insert' | 'update' | 'cancel' | 'archive' | 'status_change' | 'payment_change';
          previous_value?: Json | null;
          new_value?: Json | null;
          created_at?: string;
        };
      };
    };
    Views: {
      accounting_invoice_totals: {
        Row: {
          organization_id: string | null;
          branch_id: string | null;
          invoice_count: number | null;
          total_billed: number | null;
          total_pending: number | null;
          total_collected: number | null;
        };
      };
    };
    Functions: {
      current_role: {
        Args: Record<PropertyKey, never>;
        Returns: 'super_admin' | 'organization_admin' | 'branch_manager' | null;
      };
      current_organization_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      current_branch_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      is_super_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      can_access_organization: {
        Args: { target_org_id: string };
        Returns: boolean;
      };
      can_access_branch: {
        Args: { target_branch_id: string };
        Returns: boolean;
      };
      sync_invoice_payment_status: {
        Args: { p_invoice_id: string };
        Returns: void;
      };
      generate_monthly_renewals: {
        Args: { p_run_date?: string };
        Returns: number;
      };
    };
    Enums: {
      app_role: 'super_admin' | 'organization_admin' | 'branch_manager';
      record_status: 'active' | 'inactive' | 'archived';
      package_billing_type: 'one_time' | 'recurring_monthly';
      invoice_status: 'draft' | 'unpaid' | 'partial' | 'completed' | 'cancelled';
      payment_status: 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded';
      payment_method: 'cash' | 'card' | 'upi' | 'online' | 'bank_transfer';
      renewal_status: 'pending' | 'completed' | 'cancelled' | 'overdue';
      audit_action: 'insert' | 'update' | 'cancel' | 'archive' | 'status_change' | 'payment_change';
    };
  };
};
