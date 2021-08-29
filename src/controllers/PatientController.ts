import { Request, Response } from "express";
import { getCustomRepository } from 'typeorm';
import bcrypt from 'bcrypt'
import dayjs from 'dayjs'

import * as jwt from "../jwt"
import { Patient, RefreshToken } from "../models";
import { RefreshTokenRepository, PatientsRepository } from "../repositories";
import { PatientAlreadyExistsError } from "../errors";
import { refreshTokenExpiresIn } from "../refreshTokenExpiration";

class PatientController{
  async create(request: Request, response: Response){
    const body = request.body;
    
    const patientsRepository = getCustomRepository(PatientsRepository)

    const patientAlreadyExists = await patientsRepository.findOne({ 
      where: [
        { CPF: body.CPF }, 
        { email: body.email }
      ] 
    })

    if(patientAlreadyExists){
      throw new PatientAlreadyExistsError()
    }

    body.createdAt = new Date()

    try {
      const patientBody = patientsRepository.create(body)
      const patient: any = await patientsRepository.save(patientBody)
      const patientId = patient.id
      
      const refreshTokenRepository = getCustomRepository(RefreshTokenRepository)

      const refreshTokenBody = refreshTokenRepository.create({
        patientId,
        expiresIn: refreshTokenExpiresIn()
      })

      const refreshToken = await refreshTokenRepository.save(refreshTokenBody)

      const token = jwt.sign({
          id: patient.id,
          type: 'patient'
      })

      patient.password = undefined
      return response.status(201).json({ 
        success: "Paciente criado com sucesso",
        patient, 
        token, 
        refreshToken 
      })
    } catch (error) {
      return response.status(403).json({
        error: "Erro na criação do paciente"
      })
    }
  }

  async loginPost(request: Request, response: Response){
    const { email, password } = request.body

    const patientsRepository = getCustomRepository(PatientsRepository)
    
    if(!password) {
      return response.status(401).json({
        error: "Senha não informada"
      })
    }

    if(!email) {
      return response.status(401).json({
        error: "Email não informada"
      })
    }
    
    const patientExists: any = await patientsRepository.findOne({
      where: { email }, 
      select: ['id', 'email', 'password']
    })

    if (!patientExists) {
      return response.status(401).json({
        error: "Email e/ou senha inválidos"
      })
    }

    
    const validPassword = await bcrypt.compare(password, patientExists.password)

    if(validPassword) {
      try {
        const patientId = patientExists.id

        const token = jwt.sign({
          id: patientId,
          type: 'patient'
        })
  
        const refreshTokenRepository = getCustomRepository(RefreshTokenRepository)
  
        const refreshTokenExists = await refreshTokenRepository.findOne({
          patientId
        })
        
        if(refreshTokenExists) {
          await refreshTokenRepository.createQueryBuilder()
          .delete()
          .from(RefreshToken)
          .where("patientId = :id", { id: patientId })
          .execute()
        }
  
        const refreshTokenBody = refreshTokenRepository.create({
          patientId,
          expiresIn: refreshTokenExpiresIn()
        })
  
        const refreshToken = await refreshTokenRepository.save(refreshTokenBody)

        refreshToken.patientId = undefined
  
        return response.status(200).json({ patientId, token, refreshToken })
      } catch (error) {
        return response.status(400).json({
          error: "Erro no login"
        })
      }
    } else {
      return response.status(401).json({
        error: "Email e/ou senha inválidos"
      })
    }
  }

  async list(request: Request, response: Response){
    const { id, status, active } = request.query
    let filters = {}

    const patientsRepository = getCustomRepository(PatientsRepository)

    if(id) {
      filters = { ...filters, id: String(id) }

      const patient = await patientsRepository.findOne({
        id: String(id)
      })
    
      if(!patient){
        return response.status(404).json({
          error: "Paciente não encontrado"
        })
      }
    }

    if(status) {
      filters = { ...filters, status: String(status) }
    }

    if(active) {     
      if(active === "true") {
        filters = { ...filters, activeAccount: true }
      } else {
        filters = { ...filters, activeAccount: false }
      }
    }   
    const patientsList = await patientsRepository.find(filters)

    return response.json(patientsList)
  } 

  async getOneWithToken(request, response: Response) {
    const { id, type } = request.tokenPayload

    if(type !== 'patient') {
      return response.status(401).json({
        error: "Token inválido para essa requisição"
      })
    }
    
    const patientsRepository = getCustomRepository(PatientsRepository)
    const user = await patientsRepository.findOne({ id })

    if(!user) {
      return response.status(401).json({
        error: "Paciente inválido"
      })
    }
    
    return response.status(200).json(user)
  }

  async alterOne(request: Request, response: Response){
    const body = request.body
    const { id } = request.params

    const patientsRepository = getCustomRepository(PatientsRepository)

    const patient = await patientsRepository.findOne({ id })
      
    if(!patient){
      return response.status(404).json({
        error: "Paciente não encontrado"
      })
    }

    if(body.password){
      const hash = await bcrypt.hash(body.password, 10)
      body.password = hash
    }

    try {
      await patientsRepository.createQueryBuilder()
        .update(Patient)
        .set(body)
        .where("id = :id", { id })
        .execute();
      return response.status(200).json({
        success: "Paciente atualizado com sucesso"
      })
    } catch (error) {
      return response.status(403).json({
        error: "Erro na atualização do paciente"
      })
    }
  }

  async deleteOne(request: Request, response: Response){
    const { id } = request.params

    const patientsRepository = getCustomRepository(PatientsRepository)

    const patient = await patientsRepository.findOne({ id })
    
    if(!patient){
      return response.status(404).json({
        error: "Paciente não encontrado"
      })
    }

    try {
      await patientsRepository.createQueryBuilder()
        .delete()
        .from(Patient)
        .where("id = :id", { id })
        .execute();
      return response.status(200).json({
        success: "Paciente deletado com sucesso"
      })
    } catch (error) {
      return response.status(403).json({
        error: "Erro na deleção do paciente"
      })
    }
  }

  async deactivateAccount(request: Request, response: Response){
    const { id } = request.params

    const patientsRepository = getCustomRepository(PatientsRepository)

    const patient = await patientsRepository.findOne({ id })
    
    if(!patient){
      return response.status(404).json({
        error: "Paciente não encontrado"
      })
    }

    try {
      await patientsRepository.createQueryBuilder()
        .update(Patient)
        .set({ activeAccount: false })
        .where("id = :id", { id })
        .execute()
      return response.status(200).json({
        success: "Conta desativada com sucesso"
      })
    } catch (error) {
      return response.status(403).json({
        error: "Erro na desativação da conta"
      })
    }
  }
}

export { PatientController }