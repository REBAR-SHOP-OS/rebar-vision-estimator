export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      agent_knowledge: {
        Row: {
          content: string | null
          created_at: string
          file_name: string | null
          file_path: string | null
          id: string
          title: string | null
          type: string
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          title?: string | null
          type?: string
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          title?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_training_examples: {
        Row: {
          answer_file_name: string | null
          answer_file_path: string | null
          answer_text: string | null
          blueprint_file_names: string[] | null
          blueprint_file_paths: string[] | null
          created_at: string
          description: string | null
          id: string
          title: string
          user_id: string
        }
        Insert: {
          answer_file_name?: string | null
          answer_file_path?: string | null
          answer_text?: string | null
          blueprint_file_names?: string[] | null
          blueprint_file_paths?: string[] | null
          created_at?: string
          description?: string | null
          id?: string
          title: string
          user_id: string
        }
        Update: {
          answer_file_name?: string | null
          answer_file_path?: string | null
          answer_text?: string | null
          blueprint_file_names?: string[] | null
          blueprint_file_paths?: string[] | null
          created_at?: string
          description?: string | null
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      analysis_jobs: {
        Row: {
          created_at: string | null
          error: string | null
          id: string
          project_id: string | null
          request_payload: Json | null
          result: Json | null
          signed_urls: string[] | null
          status: string
          storage_paths: string[] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          id?: string
          project_id?: string | null
          request_payload?: Json | null
          result?: Json | null
          signed_urls?: string[] | null
          status?: string
          storage_paths?: string[] | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          error?: string | null
          id?: string
          project_id?: string | null
          request_payload?: Json | null
          result?: Json | null
          signed_urls?: string[] | null
          status?: string
          storage_paths?: string[] | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      approvals: {
        Row: {
          approval_type: string | null
          created_at: string | null
          id: string
          notes: string | null
          project_id: string
          resolved_at: string | null
          reviewer_email: string | null
          reviewer_name: string | null
          segment_id: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          approval_type?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          project_id: string
          resolved_at?: string | null
          reviewer_email?: string | null
          reviewer_name?: string | null
          segment_id?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          approval_type?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          resolved_at?: string | null
          reviewer_email?: string | null
          reviewer_name?: string | null
          segment_id?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          project_id: string | null
          segment_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          project_id?: string | null
          segment_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          project_id?: string | null
          segment_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          project_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          project_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          project_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      bar_items: {
        Row: {
          confidence: number | null
          cover_value: number | null
          created_at: string | null
          cut_length: number | null
          deterministic_match: boolean
          estimate_item_id: string | null
          finish_type: string | null
          id: string
          lap_length: number | null
          mark: string | null
          provenance_state: string
          quantity: number | null
          segment_id: string
          shape_code: string | null
          size: string | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          cover_value?: number | null
          created_at?: string | null
          cut_length?: number | null
          deterministic_match?: boolean
          estimate_item_id?: string | null
          finish_type?: string | null
          id?: string
          lap_length?: number | null
          mark?: string | null
          provenance_state?: string
          quantity?: number | null
          segment_id: string
          shape_code?: string | null
          size?: string | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          cover_value?: number | null
          created_at?: string | null
          cut_length?: number | null
          deterministic_match?: boolean
          estimate_item_id?: string | null
          finish_type?: string | null
          id?: string
          lap_length?: number | null
          mark?: string | null
          provenance_state?: string
          quantity?: number | null
          segment_id?: string
          shape_code?: string | null
          size?: string | null
          user_id?: string
        }
        Relationships: []
      }
      crm_deals: {
        Row: {
          close_date: string | null
          company_name: string | null
          crm_deal_id: string
          deal_name: string | null
          deal_value: number | null
          id: string
          metadata: Json | null
          stage: string | null
          status: string | null
          synced_at: string | null
          user_id: string
        }
        Insert: {
          close_date?: string | null
          company_name?: string | null
          crm_deal_id: string
          deal_name?: string | null
          deal_value?: number | null
          id?: string
          metadata?: Json | null
          stage?: string | null
          status?: string | null
          synced_at?: string | null
          user_id: string
        }
        Update: {
          close_date?: string | null
          company_name?: string | null
          crm_deal_id?: string
          deal_name?: string | null
          deal_value?: number | null
          id?: string
          metadata?: Json | null
          stage?: string | null
          status?: string | null
          synced_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      document_versions: {
        Row: {
          created_at: string
          file_id: string | null
          file_name: string | null
          file_path: string | null
          id: string
          is_scanned: boolean | null
          page_count: number | null
          parse_error: string | null
          parse_status: string
          parsed_at: string | null
          pdf_metadata: Json | null
          project_id: string
          sha256: string
          source_system: string | null
          upload_timestamp: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          file_id?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          is_scanned?: boolean | null
          page_count?: number | null
          parse_error?: string | null
          parse_status?: string
          parsed_at?: string | null
          pdf_metadata?: Json | null
          project_id: string
          sha256: string
          source_system?: string | null
          upload_timestamp?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          file_id?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          is_scanned?: boolean | null
          page_count?: number | null
          parse_error?: string | null
          parse_status?: string
          parsed_at?: string | null
          pdf_metadata?: Json | null
          project_id?: string
          sha256?: string
          source_system?: string | null
          upload_timestamp?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "project_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      drawing_search_index: {
        Row: {
          bar_marks: string[]
          created_at: string
          crm_deal_id: string | null
          document_version_id: string | null
          extracted_entities: Json
          id: string
          issue_status: string | null
          logical_drawing_id: string | null
          page_number: number | null
          project_id: string
          raw_text: string
          revision_label: string | null
          search_tsv: unknown
          sheet_revision_id: string | null
          user_id: string
        }
        Insert: {
          bar_marks?: string[]
          created_at?: string
          crm_deal_id?: string | null
          document_version_id?: string | null
          extracted_entities?: Json
          id?: string
          issue_status?: string | null
          logical_drawing_id?: string | null
          page_number?: number | null
          project_id: string
          raw_text?: string
          revision_label?: string | null
          search_tsv?: unknown
          sheet_revision_id?: string | null
          user_id: string
        }
        Update: {
          bar_marks?: string[]
          created_at?: string
          crm_deal_id?: string | null
          document_version_id?: string | null
          extracted_entities?: Json
          id?: string
          issue_status?: string | null
          logical_drawing_id?: string | null
          page_number?: number | null
          project_id?: string
          raw_text?: string
          revision_label?: string | null
          search_tsv?: unknown
          sheet_revision_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drawing_search_index_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_search_index_logical_drawing_id_fkey"
            columns: ["logical_drawing_id"]
            isOneToOne: false
            referencedRelation: "logical_drawings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_search_index_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_search_index_sheet_revision_id_fkey"
            columns: ["sheet_revision_id"]
            isOneToOne: false
            referencedRelation: "sheet_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      drawing_sets: {
        Row: {
          created_at: string
          id: string
          issue_date: string | null
          issue_purpose: string | null
          notes: string | null
          project_id: string
          set_name: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          issue_date?: string | null
          issue_purpose?: string | null
          notes?: string | null
          project_id: string
          set_name?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          issue_date?: string | null
          issue_purpose?: string | null
          notes?: string | null
          project_id?: string
          set_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drawing_sets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      drawing_views: {
        Row: {
          confidence: number | null
          created_at: string | null
          generated_json: Json | null
          id: string
          revision_label: string | null
          segment_id: string
          status: string | null
          title: string | null
          user_id: string
          view_type: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          generated_json?: Json | null
          id?: string
          revision_label?: string | null
          segment_id: string
          status?: string | null
          title?: string | null
          user_id: string
          view_type?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          generated_json?: Json | null
          id?: string
          revision_label?: string | null
          segment_id?: string
          status?: string | null
          title?: string | null
          user_id?: string
          view_type?: string | null
        }
        Relationships: []
      }
      estimate_items: {
        Row: {
          assumptions_json: Json | null
          bar_size: string | null
          confidence: number | null
          created_at: string | null
          description: string | null
          exclusions_json: Json | null
          id: string
          item_type: string | null
          labor_factor: number | null
          project_id: string
          quantity_count: number | null
          segment_id: string
          source_file_id: string | null
          status: string | null
          total_length: number | null
          total_weight: number | null
          user_id: string
          waste_factor: number | null
        }
        Insert: {
          assumptions_json?: Json | null
          bar_size?: string | null
          confidence?: number | null
          created_at?: string | null
          description?: string | null
          exclusions_json?: Json | null
          id?: string
          item_type?: string | null
          labor_factor?: number | null
          project_id: string
          quantity_count?: number | null
          segment_id: string
          source_file_id?: string | null
          status?: string | null
          total_length?: number | null
          total_weight?: number | null
          user_id: string
          waste_factor?: number | null
        }
        Update: {
          assumptions_json?: Json | null
          bar_size?: string | null
          confidence?: number | null
          created_at?: string | null
          description?: string | null
          exclusions_json?: Json | null
          id?: string
          item_type?: string | null
          labor_factor?: number | null
          project_id?: string
          quantity_count?: number | null
          segment_id?: string
          source_file_id?: string | null
          status?: string | null
          total_length?: number | null
          total_weight?: number | null
          user_id?: string
          waste_factor?: number | null
        }
        Relationships: []
      }
      estimate_outcomes: {
        Row: {
          actual_cost: number | null
          actual_weight_kg: number | null
          award_status: string | null
          change_orders_total: number | null
          created_at: string | null
          crm_deal_id: string | null
          drawing_set_id: string | null
          estimate_version_id: string | null
          id: string
          notes: string | null
          project_id: string | null
          quoted_price: number | null
          quoted_weight_kg: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          actual_cost?: number | null
          actual_weight_kg?: number | null
          award_status?: string | null
          change_orders_total?: number | null
          created_at?: string | null
          crm_deal_id?: string | null
          drawing_set_id?: string | null
          estimate_version_id?: string | null
          id?: string
          notes?: string | null
          project_id?: string | null
          quoted_price?: number | null
          quoted_weight_kg?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          actual_cost?: number | null
          actual_weight_kg?: number | null
          award_status?: string | null
          change_orders_total?: number | null
          created_at?: string | null
          crm_deal_id?: string | null
          drawing_set_id?: string | null
          estimate_version_id?: string | null
          id?: string
          notes?: string | null
          project_id?: string | null
          quoted_price?: number | null
          quoted_weight_kg?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_outcomes_drawing_set_id_fkey"
            columns: ["drawing_set_id"]
            isOneToOne: false
            referencedRelation: "drawing_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_outcomes_estimate_version_id_fkey"
            columns: ["estimate_version_id"]
            isOneToOne: false
            referencedRelation: "estimate_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_outcomes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_versions: {
        Row: {
          assumptions_text: string | null
          confidence_score: number | null
          created_at: string
          currency: string | null
          drawing_set_ids: string[] | null
          estimator_notes: string | null
          id: string
          issued_at: string | null
          line_items: Json | null
          project_id: string
          scope_confidence: number | null
          scope_source_reference: string | null
          scope_source_type: string | null
          status: string | null
          total_estimated_cost: number | null
          total_quoted_price: number | null
          user_id: string
          version_number: number
        }
        Insert: {
          assumptions_text?: string | null
          confidence_score?: number | null
          created_at?: string
          currency?: string | null
          drawing_set_ids?: string[] | null
          estimator_notes?: string | null
          id?: string
          issued_at?: string | null
          line_items?: Json | null
          project_id: string
          scope_confidence?: number | null
          scope_source_reference?: string | null
          scope_source_type?: string | null
          status?: string | null
          total_estimated_cost?: number | null
          total_quoted_price?: number | null
          user_id: string
          version_number?: number
        }
        Update: {
          assumptions_text?: string | null
          confidence_score?: number | null
          created_at?: string
          currency?: string | null
          drawing_set_ids?: string[] | null
          estimator_notes?: string | null
          id?: string
          issued_at?: string | null
          line_items?: Json | null
          project_id?: string
          scope_confidence?: number | null
          scope_source_reference?: string | null
          scope_source_type?: string | null
          status?: string | null
          total_estimated_cost?: number | null
          total_quoted_price?: number | null
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_ups: {
        Row: {
          action: string
          created_at: string | null
          due_date: string | null
          id: string
          notes: string | null
          project_id: string
          status: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          project_id: string
          status?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      logical_drawings: {
        Row: {
          created_at: string
          discipline: string | null
          drawing_type: string | null
          id: string
          project_id: string
          sheet_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          discipline?: string | null
          drawing_type?: string | null
          id?: string
          project_id: string
          sheet_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          discipline?: string | null
          drawing_type?: string | null
          id?: string
          project_id?: string
          sheet_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "logical_drawings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata: Json | null
          project_id: string
          role: string
          step: number | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata?: Json | null
          project_id: string
          role: string
          step?: number | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          project_id?: string
          role?: string
          step?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          channel: string
          created_at: string | null
          id: string
          metadata: Json | null
          notification_type: string
          project_id: string
          recipient_email: string
          recipient_name: string | null
          status: string | null
          subject: string | null
        }
        Insert: {
          body?: string | null
          channel?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          notification_type: string
          project_id: string
          recipient_email: string
          recipient_name?: string | null
          status?: string | null
          subject?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          notification_type?: string
          project_id?: string
          recipient_email?: string
          recipient_name?: string | null
          status?: string | null
          subject?: string | null
        }
        Relationships: []
      }
      orders: {
        Row: {
          created_at: string
          currency: string | null
          customer_email: string | null
          customer_name: string | null
          due_date: string | null
          id: string
          notes: string | null
          order_number: string
          price_per_ton: number | null
          pricing_status: string | null
          project_id: string | null
          status: string
          total_price: number | null
          total_weight_kg: number | null
          updated_at: string
          user_id: string
          validation_status: string | null
        }
        Insert: {
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          customer_name?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          order_number?: string
          price_per_ton?: number | null
          pricing_status?: string | null
          project_id?: string | null
          status?: string
          total_price?: number | null
          total_weight_kg?: number | null
          updated_at?: string
          user_id: string
          validation_status?: string | null
        }
        Update: {
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          customer_name?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          order_number?: string
          price_per_ton?: number | null
          pricing_status?: string | null
          project_id?: string | null
          status?: string
          total_price?: number | null
          total_weight_kg?: number | null
          updated_at?: string
          user_id?: string
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          input_file_id: string | null
          job_type: string
          progress: number | null
          project_id: string
          result: Json | null
          retry_count: number | null
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_file_id?: string | null
          job_type?: string
          progress?: number | null
          project_id: string
          result?: Json | null
          retry_count?: number | null
          started_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_file_id?: string | null
          job_type?: string
          progress?: number | null
          project_id?: string
          result?: Json | null
          retry_count?: number | null
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          preferred_language: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_language?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_language?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_files: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address: string | null
          client_name: string | null
          created_at: string
          description: string | null
          deviations: string | null
          duplicate_of: string | null
          id: string
          intake_complete: boolean | null
          linkage_score: string | null
          name: string
          normalized_name: string | null
          project_type: string | null
          scope_items: string[] | null
          status: string
          updated_at: string
          user_id: string
          workflow_status: string | null
        }
        Insert: {
          address?: string | null
          client_name?: string | null
          created_at?: string
          description?: string | null
          deviations?: string | null
          duplicate_of?: string | null
          id?: string
          intake_complete?: boolean | null
          linkage_score?: string | null
          name: string
          normalized_name?: string | null
          project_type?: string | null
          scope_items?: string[] | null
          status?: string
          updated_at?: string
          user_id: string
          workflow_status?: string | null
        }
        Update: {
          address?: string | null
          client_name?: string | null
          created_at?: string
          description?: string | null
          deviations?: string | null
          duplicate_of?: string | null
          id?: string
          intake_complete?: boolean | null
          linkage_score?: string | null
          name?: string
          normalized_name?: string | null
          project_type?: string | null
          scope_items?: string[] | null
          status?: string
          updated_at?: string
          user_id?: string
          workflow_status?: string | null
        }
        Relationships: []
      }
      quote_versions: {
        Row: {
          created_at: string
          currency: string | null
          estimate_version_id: string
          exclusions_text: string | null
          id: string
          issued_at: string | null
          project_id: string
          quoted_price: number | null
          status: string | null
          terms_text: string | null
          user_id: string
          version_number: number
        }
        Insert: {
          created_at?: string
          currency?: string | null
          estimate_version_id: string
          exclusions_text?: string | null
          id?: string
          issued_at?: string | null
          project_id: string
          quoted_price?: number | null
          status?: string | null
          terms_text?: string | null
          user_id: string
          version_number?: number
        }
        Update: {
          created_at?: string
          currency?: string | null
          estimate_version_id?: string
          exclusions_text?: string | null
          id?: string
          issued_at?: string | null
          project_id?: string
          quoted_price?: number | null
          status?: string | null
          terms_text?: string | null
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_versions_estimate_version_id_fkey"
            columns: ["estimate_version_id"]
            isOneToOne: false
            referencedRelation: "estimate_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_records: {
        Row: {
          automated_reasoning: Json | null
          candidates: Json | null
          created_at: string
          human_resolution: Json | null
          id: string
          issue_type: string
          notes: string | null
          project_id: string
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          user_id: string
        }
        Insert: {
          automated_reasoning?: Json | null
          candidates?: Json | null
          created_at?: string
          human_resolution?: Json | null
          id?: string
          issue_type: string
          notes?: string | null
          project_id: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          user_id: string
        }
        Update: {
          automated_reasoning?: Json | null
          candidates?: Json | null
          created_at?: string
          human_resolution?: Json | null
          id?: string
          issue_type?: string
          notes?: string | null
          project_id?: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      review_comments: {
        Row: {
          author_email: string
          author_name: string
          content: string
          created_at: string
          id: string
          share_id: string
        }
        Insert: {
          author_email: string
          author_name: string
          content: string
          created_at?: string
          id?: string
          share_id: string
        }
        Update: {
          author_email?: string
          author_name?: string
          content?: string
          created_at?: string
          id?: string
          share_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_comments_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "review_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      review_queue: {
        Row: {
          confidence: number | null
          created_at: string
          id: string
          item_data: Json | null
          item_type: string
          priority: string | null
          project_id: string
          resolved_at: string | null
          resolved_data: Json | null
          status: string | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          id?: string
          item_data?: Json | null
          item_type: string
          priority?: string | null
          project_id: string
          resolved_at?: string | null
          resolved_data?: Json | null
          status?: string | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          id?: string
          item_data?: Json | null
          item_type?: string
          priority?: string | null
          project_id?: string
          resolved_at?: string | null
          resolved_data?: Json | null
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_queue_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      review_shares: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          project_id: string
          review_data: Json | null
          review_type: string | null
          reviewer_email: string
          reviewer_name: string | null
          share_token: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          project_id: string
          review_data?: Json | null
          review_type?: string | null
          reviewer_email: string
          reviewer_name?: string | null
          share_token: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          project_id?: string
          review_data?: Json | null
          review_type?: string | null
          reviewer_email?: string
          reviewer_name?: string | null
          share_token?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_shares_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      scope_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean | null
          metadata: Json | null
          name: string
          project_type: string | null
          scope_items: string[]
          slug: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean | null
          metadata?: Json | null
          name: string
          project_type?: string | null
          scope_items?: string[]
          slug: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean | null
          metadata?: Json | null
          name?: string
          project_type?: string | null
          scope_items?: string[]
          slug?: string
          user_id?: string | null
        }
        Relationships: []
      }
      segment_source_links: {
        Row: {
          file_id: string
          id: string
          linked_at: string | null
          segment_id: string
          user_id: string
        }
        Insert: {
          file_id: string
          id?: string
          linked_at?: string | null
          segment_id: string
          user_id: string
        }
        Update: {
          file_id?: string
          id?: string
          linked_at?: string | null
          segment_id?: string
          user_id?: string
        }
        Relationships: []
      }
      segments: {
        Row: {
          confidence: number | null
          created_at: string | null
          drawing_readiness: string | null
          id: string
          level_label: string | null
          name: string
          notes: string | null
          project_id: string
          segment_type: string
          status: string | null
          updated_at: string | null
          user_id: string
          zone_label: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          drawing_readiness?: string | null
          id?: string
          level_label?: string | null
          name: string
          notes?: string | null
          project_id: string
          segment_type?: string
          status?: string | null
          updated_at?: string | null
          user_id: string
          zone_label?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          drawing_readiness?: string | null
          id?: string
          level_label?: string | null
          name?: string
          notes?: string | null
          project_id?: string
          segment_type?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
          zone_label?: string | null
        }
        Relationships: []
      }
      sheet_revisions: {
        Row: {
          created_at: string
          discipline: string | null
          document_version_id: string | null
          drawing_set_id: string
          drawing_type: string | null
          extraction_metadata: Json | null
          id: string
          page_number: number | null
          revision_code: string | null
          revision_date: string | null
          revision_description: string | null
          scale_confidence: number | null
          scale_ratio: number | null
          scale_raw: string | null
          sheet_number: string | null
          sheet_title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          discipline?: string | null
          document_version_id?: string | null
          drawing_set_id: string
          drawing_type?: string | null
          extraction_metadata?: Json | null
          id?: string
          page_number?: number | null
          revision_code?: string | null
          revision_date?: string | null
          revision_description?: string | null
          scale_confidence?: number | null
          scale_ratio?: number | null
          scale_raw?: string | null
          sheet_number?: string | null
          sheet_title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          discipline?: string | null
          document_version_id?: string | null
          drawing_set_id?: string
          drawing_type?: string | null
          extraction_metadata?: Json | null
          id?: string
          page_number?: number | null
          revision_code?: string | null
          revision_date?: string | null
          revision_description?: string | null
          scale_confidence?: number | null
          scale_ratio?: number | null
          scale_raw?: string | null
          sheet_number?: string | null
          sheet_title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_revisions_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_revisions_drawing_set_id_fkey"
            columns: ["drawing_set_id"]
            isOneToOne: false
            referencedRelation: "drawing_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_drawings: {
        Row: {
          created_at: string
          drawing_mode: string
          export_class: string | null
          html_content: string
          id: string
          options: Json
          project_id: string
          user_id: string
          validation_state: Json
          version: number
          watermark_mode: string
        }
        Insert: {
          created_at?: string
          drawing_mode?: string
          export_class?: string | null
          html_content: string
          id?: string
          options?: Json
          project_id: string
          user_id: string
          validation_state?: Json
          version?: number
          watermark_mode?: string
        }
        Update: {
          created_at?: string
          drawing_mode?: string
          export_class?: string | null
          html_content?: string
          id?: string
          options?: Json
          project_id?: string
          user_id?: string
          validation_state?: Json
          version?: number
          watermark_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_drawings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      standards_profiles: {
        Row: {
          code_family: string | null
          cover_defaults: Json | null
          created_at: string | null
          hook_defaults: Json | null
          id: string
          is_default: boolean | null
          lap_defaults: Json | null
          name: string
          naming_rules: Json | null
          units: string | null
          user_id: string
        }
        Insert: {
          code_family?: string | null
          cover_defaults?: Json | null
          created_at?: string | null
          hook_defaults?: Json | null
          id?: string
          is_default?: boolean | null
          lap_defaults?: Json | null
          name: string
          naming_rules?: Json | null
          units?: string | null
          user_id: string
        }
        Update: {
          code_family?: string | null
          cover_defaults?: Json | null
          created_at?: string | null
          hook_defaults?: Json | null
          id?: string
          is_default?: boolean | null
          lap_defaults?: Json | null
          name?: string
          naming_rules?: Json | null
          units?: string | null
          user_id?: string
        }
        Relationships: []
      }
      symbol_lexicon: {
        Row: {
          context: Json | null
          created_at: string
          id: string
          is_global: boolean | null
          lexicon_version: string | null
          meaning: string
          patterns: string[]
          symbol_id: string
          unit_default: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: string
          is_global?: boolean | null
          lexicon_version?: string | null
          meaning: string
          patterns?: string[]
          symbol_id: string
          unit_default?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: string
          is_global?: boolean | null
          lexicon_version?: string | null
          meaning?: string
          patterns?: string[]
          symbol_id?: string
          unit_default?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      validation_issues: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          description: string | null
          id: string
          issue_type: string
          project_id: string
          resolution_note: string | null
          segment_id: string | null
          severity: string | null
          sheet_id: string | null
          source_file_id: string | null
          source_refs: Json | null
          status: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          issue_type: string
          project_id: string
          resolution_note?: string | null
          segment_id?: string | null
          severity?: string | null
          sheet_id?: string | null
          source_file_id?: string | null
          source_refs?: Json | null
          status?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          issue_type?: string
          project_id?: string
          resolution_note?: string | null
          segment_id?: string | null
          severity?: string | null
          sheet_id?: string | null
          source_file_id?: string | null
          source_refs?: Json | null
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      verified_estimate_results: {
        Row: {
          blocked_reasons: Json | null
          content_hash: string
          created_at: string
          id: string
          inputs_hash: string | null
          is_current: boolean
          project_id: string
          result_json: Json
          status: string
          user_id: string
          version_number: number
        }
        Insert: {
          blocked_reasons?: Json | null
          content_hash: string
          created_at?: string
          id?: string
          inputs_hash?: string | null
          is_current?: boolean
          project_id: string
          result_json: Json
          status: string
          user_id: string
          version_number?: number
        }
        Update: {
          blocked_reasons?: Json | null
          content_hash?: string
          created_at?: string
          id?: string
          inputs_hash?: string | null
          is_current?: boolean
          project_id?: string
          result_json?: Json
          status?: string
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "verified_estimate_results_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      search_drawings: {
        Args: {
          p_filters?: Json
          p_limit?: number
          p_query?: string
          p_user_id: string
        }
        Returns: {
          bar_marks: string[]
          confidence: number
          created_at: string
          crm_deal_id: string
          discipline: string
          drawing_type: string
          extracted_entities: Json
          headline: string
          id: string
          issue_status: string
          logical_drawing_id: string
          needs_review: boolean
          page_number: number
          project_id: string
          project_name: string
          quality_flags: string[]
          rank: number
          revision_chain_id: string
          revision_label: string
          sha256: string
          sheet_id: string
          source_system: string
        }[]
      }
      upsert_search_index: {
        Args: {
          p_bar_marks?: string[]
          p_crm_deal_id?: string
          p_document_version_id?: string
          p_extracted_entities?: Json
          p_issue_status?: string
          p_logical_drawing_id: string
          p_page_number?: number
          p_project_id: string
          p_raw_text?: string
          p_revision_label?: string
          p_sheet_revision_id?: string
          p_user_id: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
